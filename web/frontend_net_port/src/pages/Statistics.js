import React, { useState, useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import isEmpty from "lodash/isEmpty";
import { useCookies } from "react-cookie";

import { ApiContext } from "../context/ApiContext";

import Paper from "@mui/material/Paper";
import TableContainer from "@mui/material/TableContainer";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import Typography from "@mui/material/Typography";
import { Loader } from "../components/Loader";

const Statistics = ({ children, ...rest }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();

    const [isLoaded, setIsLoaded] = useState(false);
    const [statisticsData, setStatisticsData] = useState([]);
    const history = useNavigate();

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    useEffect(() => {
        const abortController = new AbortController();
        async function fetchData(abortController) {
            let response_error = false;

            if (isEmpty(cookies.user)) {
                history("/main");
                return;
            }

            const statistics = await api
                .get(`/statistics`, {
                    signal: abortController.signal,
                })
                .catch((err) => {
                    if (err.response.status === 401) {
                        handleLogout();
                    } else {
                        setError(err);
                    }
                    response_error = true;
                });

            if (response_error) return;
            if (abortController.signal.aborted) return;

            if (statistics.status === 200) {
                setStatisticsData(statistics.data);
                setIsLoaded(true);
            }
        }
        fetchData(abortController);

        return () => {
            //abortController.abort();
        };
    }, []);

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
    };

    // Функция для форматирования байтов в читаемый формат
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Функция для форматирования времени
    const formatTimestamp = (timestamp) => {
        const date = new Date(timestamp);
        return date.toLocaleString();
    };

    return (
        <>
            {!isEmpty(cookies.user) ? (
                <div style={{ padding: '20px' }}>
                    <Typography variant="h4" gutterBottom>
                        Статистика серверов
                    </Typography>
                    
                    {isLoaded && !isEmpty(statisticsData) ? (
                        <TableContainer component={Paper} sx={{ mt: 2 }}>
                            <Table sx={{ minWidth: 650 }} aria-label="statistics table">
                                <TableHead>
                                    <TableRow>
                                        <TableCell><b>ID Сервера</b></TableCell>
                                        <TableCell><b>Байт получено</b></TableCell>
                                        <TableCell><b>Байт отправлено</b></TableCell>
                                        <TableCell><b>Активные соединения</b></TableCell>
                                        <TableCell><b>Время обновления</b></TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {statisticsData
                                        .sort(function (a, b) {
                                            return b.timestamp - a.timestamp;
                                        })
                                        .map((stat) => (
                                            <TableRow key={`${stat.server_id}-${stat.timestamp}`}>
                                                <TableCell>{stat.server_id}</TableCell>
                                                <TableCell>{formatBytes(stat.bytes_received)}</TableCell>
                                                <TableCell>{formatBytes(stat.bytes_sent)}</TableCell>
                                                <TableCell>{stat.connections_count}</TableCell>
                                                <TableCell>{formatTimestamp(stat.timestamp)}</TableCell>
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    ) : (
                        <Loader title={"Статистика не доступна"} />
                    )}
                </div>
            ) : (
                <></>
            )}
        </>
    );
};

export default Statistics;