import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import isEmpty from 'lodash/isEmpty';
import { useCookies } from 'react-cookie';

import { ApiContext } from '../context/ApiContext';

import Paper from '@mui/material/Paper';
import Button from "@mui/material/Button";
import TableContainer from '@mui/material/TableContainer';
import Table from '@mui/material/Table';
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";

import { Loader } from '../components/Loader';
import { ServerSettingsData } from './ServerSettings/ServerSettingsData';
import CommonDialog from '../components/CommonDialog';

const Servers = () => {
    const { api } = useContext(ApiContext);
    const [cookies] = useCookies();

    const [isLoaded, setIsLoaded] = useState(false);
    const [serversData, setServersData] = useState();
    const history = useNavigate();

    const [open, setOpen] = useState(false);
    const [serverDeleteId, setServerDeleteId] = useState(null);

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    useEffect(() => {
        const abortController = new AbortController();
        async function fetchData(abortController) {
            let response_error = false;

            const servers = await api
                .get(`/servers/${cookies.user.id}`, {
                    signal: abortController.signal
                })
                .catch((err) => {
                    response_error = true;
                    setError(err);
                });

            if (response_error) return;
            if (abortController.signal.aborted) return;

            if (servers.status === 200) {
                console.log(servers.data);

                setServersData(servers.data);
                setIsLoaded(true);
            }
        }
        fetchData(abortController);

        return () => {
            //abortController.abort();
        }
    }, []);

    const newHandler = () => history(`/servers/new`);
    const editHandler = (id) => history(`/servers/edit/${id}`);
    const deleteHandler = async (id) => {
        setServerDeleteId(id);
        setOpen(true);
    };

    const removeModalHandler = async () => {
        const users = await api
            .delete(`/servers/${serverDeleteId}`)
            .catch((err) => {
                setError(err);
            });

        if (users.status === 200) {
            setServersData(users.data);
            setIsLoaded(true);
            setOpen(false);
        }
    };

    return (
        isLoaded && !isEmpty(serversData) ?
            <>
                <TableContainer component={Paper} sx={{ maxWidth: 540, mt: 2 }}>
                    <Table sx={{ minWidth: 450 }} aria-label="simple table">
                        <TableBody>
                            <TableRow
                                sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                            >
                                <TableCell component="th" scope="row">
                                    <b>Сервер</b>
                                </TableCell>
                                <TableCell align="right">
                                    <Button
                                        color="primary"
                                        size="large"
                                        variant="contained"
                                        type="submit"
                                        onClick={() => { newHandler(); }}
                                    >
                                        Добавить
                                    </Button>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </TableContainer>
                {serversData.sort(function (a, b) { return a.id - b.id; }).map((rs) => <ServerSettingsData key={rs.id} data={rs}
                    editHandler={() => {
                        editHandler(rs.id);
                    }}
                    deleteHandler={() => {
                        deleteHandler(rs.id);
                    }}
                />)}
                <CommonDialog
                    open={open}
                    title="Удаление сервера"
                    content="Вы действительно уверены, что хотите удалить сервер?"
                    handleCancel={() => setOpen(false)}
                    handleSubmit={() => removeModalHandler()}
                />
            </> :
            <Loader />
    )
};

export default Servers;
