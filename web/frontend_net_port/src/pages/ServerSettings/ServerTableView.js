import React from 'react';
import { useNavigate } from "react-router-dom";

import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ClearIcon from '@mui/icons-material/Clear';
import EditIcon from '@mui/icons-material/Edit';

const ServerTableView = ({ serversData, deleteHandler, editHandler }) => {
    const history = useNavigate();

    const handleEdit = (id) => {
        history(`/servers/edit/${id}`);
    };

    const handleDelete = (id) => {
        deleteHandler(id);
    };

    return (
        <TableContainer component={Paper} sx={{ mt: 2 }}>
            <Table sx={{ minWidth: 650 }} aria-label="servers table">
                <TableHead>
                    <TableRow>
                        <TableCell><b>Описание</b></TableCell>
                        <TableCell align="right"><b>Входящий порт</b></TableCell>
                        <TableCell align="right"><b>Исходящий порт</b></TableCell>
                        <TableCell align="right"><b>Статус</b></TableCell>
                        <TableCell align="right"><b>SSL вход</b></TableCell>
                        <TableCell align="right"><b>SSL выход</b></TableCell>
                        <TableCell align="right"><b>Действия</b></TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {serversData.map((server) => (
                        <TableRow
                            key={server.id}
                            sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                        >
                            <TableCell component="th" scope="row">
                                {server.description || `Сервер ${server.id}`}
                            </TableCell>
                            <TableCell align="right">{server.input_port || '---'}</TableCell>
                            <TableCell align="right">{server.output_port || '---'}</TableCell>
                            <TableCell align="right">{server.enable ? 'Включен' : 'Отключен'}</TableCell>
                            <TableCell align="right">{server.enable_input_ssl ? 'Да' : 'Нет'}</TableCell>
                            <TableCell align="right">{server.enable_ssl ? 'Да' : 'Нет'}</TableCell>
                            <TableCell align="right">
                                <IconButton 
                                    color="primary" 
                                    onClick={() => handleEdit(server.id)}
                                    size="small"
                                >
                                    <EditIcon />
                                </IconButton>
                                <IconButton 
                                    color="error" 
                                    onClick={() => handleDelete(server.id)}
                                    size="small"
                                >
                                    <ClearIcon />
                                </IconButton>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default ServerTableView;