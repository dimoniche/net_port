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
import Button from "@mui/material/Button";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import IconButton from "@mui/material/IconButton";
import { Loader } from "../components/Loader";
import ServerStatsModal from "../components/ServerStatsModal";

const Statistics = ({ children, ...rest }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();

    const [isLoaded, setIsLoaded] = useState(false);
    const [statisticsData, setStatisticsData] = useState([]);
    const [serversData, setServersData] = useState([]);
    const [selectedServer, setSelectedServer] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const history = useNavigate();

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    const fetchData = async () => {
        setIsRefreshing(true);

        if (isEmpty(cookies.user)) {
            history("/main");
            return;
        }

        try {
            // Fetch statistics data
            const statistics = await api.get(`/statistics`);

            // Fetch servers data to get descriptions
            const servers = await api.get(`/servers`);

            if (statistics.status === 200) {
                setStatisticsData(statistics.data);
                setIsLoaded(true);
            }

            if (servers.status === 200) {
                console.log('Servers data:', servers.data); // Debug log
                setServersData(servers.data);
            }
        } catch (err) {
            if (err.response && err.response.status === 401) {
                handleLogout();
            } else {
                setError(err);
            }
        } finally {
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
    };

    // Функция для форматирования байтов в читаемый формат
    const formatBytes = (bytes) => {
        // Преобразуем в число, если пришло строковое значение
        const bytesNum = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
        
        if (bytesNum === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytesNum) / Math.log(k));
        return parseFloat((bytesNum / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Функция для форматирования скорости в читаемый формат
    const formatSpeed = (speed) => {
        // Проверяем на null, undefined, NaN или нулевое значение
        if (speed === null || speed === undefined || isNaN(speed) || speed === 0) {
            return '-';
        }
        
        // Преобразуем в число, если пришло строковое значение
        const speedNum = typeof speed === 'string' ? parseFloat(speed) : speed;
        
        // Проверяем еще раз после преобразования
        if (isNaN(speedNum) || speedNum < 1) {
            return '-';
        }
        
        const k = 1024;
        const sizes = ['Bytes/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
        const i = Math.floor(Math.log(speedNum) / Math.log(k));
        return parseFloat((speedNum / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Функция для получения описания сервера
    const getServerDescription = (serverId) => {
        if (!serversData || serversData.length === 0) {
            console.log('Servers data not loaded yet or empty');
            return `Сервер #${serverId}`;
        }

        let server = serversData.find(s => s.id === serverId);
        console.log('Looking for server:', serverId, 'Found:', server ? 'Yes' : 'No');

        if (server) {
            console.log('Server data:', server);
            return server.description || server.name || `Сервер #${serverId}`;
        } else {
            console.log('Available server IDs:', serversData.map(s => s.id || s.server_id));
            return `Сервер #${serverId}`;
        }
    };

    // Функция для форматирования времени
    const formatTimestamp = (timestamp) => {
        const date = new Date(timestamp);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = String(date.getFullYear()).slice(-2); // Последние 2 цифры года
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        // Компактный формат: DD.MM.YY HH:MM
        return `${day}.${month}.${year} ${hours}:${minutes}`;
    };

    // Функция для сброса статистики по серверу
    const handleResetServerStatistics = async (serverId) => {
        try {
            // Находим сервер по ID, чтобы получить user_id
            const server = serversData.find(s => s.id === serverId);
            
            if (!server) {
                console.error(`Server with id ${serverId} not found`);
                return;
            }

            // Сбрасываем статистику по server_id
            await api.delete(`/statistics/${serverId}/reset`);
            
            // Перезагружаем сервер по user_id
            await api.post(`/servers/${server.user_id}/restart`);
            
            // Обновляем данные после сброса и перезагрузки
            await fetchData();
        } catch (err) {
            if (err.response && err.response.status === 401) {
                handleLogout();
            } else {
                setError(err);
            }
        }
    };

    return (
        <>
            {!isEmpty(cookies.user) ? (
                <div style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <Typography variant="h4" gutterBottom style={{ margin: 0 }}>
                            Статистика серверов
                        </Typography>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<RefreshIcon />}
                            onClick={fetchData}
                            disabled={isRefreshing}
                        >
                            {isRefreshing ? 'Обновление...' : 'Обновить'}
                        </Button>
                    </div>

                    {isLoaded && !isEmpty(statisticsData) ? (
                        <TableContainer component={Paper} sx={{ mt: 2 }}>
                            <Table sx={{ minWidth: 650 }} aria-label="statistics table">
                                <TableHead>
                                    <TableRow>
                                        <TableCell><b>Описание сервера</b></TableCell>
                                        <TableCell><b>Байт получено</b></TableCell>
                                        <TableCell><b>Байт отправлено</b></TableCell>
                                        <TableCell><b>Скорость приема</b></TableCell>
                                        <TableCell><b>Скорость передачи</b></TableCell>
                                        <TableCell><b>Активные соединения</b></TableCell>
                                        <TableCell><b>Время обновления</b></TableCell>
                                        <TableCell><b>Действия</b></TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {statisticsData
                                        .sort(function (a, b) {
                                            return b.timestamp - a.timestamp;
                                        })
                                        .map((stat) => (
                                            <TableRow
                                                key={`${stat.server_id}-${stat.timestamp}`}
                                                hover
                                                onClick={() => {
                                                    console.log('Server clicked:', stat.server_id); // Debug log
                                                    setSelectedServer(stat.server_id);
                                                    setModalOpen(true);
                                                }}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <TableCell>{getServerDescription(stat.server_id)}</TableCell>
                                                <TableCell>{formatBytes(stat.bytes_received)}</TableCell>
                                                <TableCell>{formatBytes(stat.bytes_sent)}</TableCell>
                                                <TableCell>{formatSpeed(stat.avg_receive_speed)}</TableCell>
                                                <TableCell>{formatSpeed(stat.avg_send_speed)}</TableCell>
                                                <TableCell>{stat.connections_count}</TableCell>
                                                <TableCell>{formatTimestamp(stat.timestamp)}</TableCell>
                                                <TableCell>
                                                    <IconButton
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleResetServerStatistics(stat.server_id);
                                                        }}
                                                        color="secondary"
                                                    >
                                                        <DeleteIcon />
                                                    </IconButton>
                                                </TableCell>
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
            <ServerStatsModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                serverId={selectedServer}
                serversData={serversData}
            />
        </>
    );
};

export default Statistics;