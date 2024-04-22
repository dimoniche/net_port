import React, { useContext, useEffect, useState, lazy } from 'react';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';

import TableContainer from '@mui/material/TableContainer';
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import ClearIcon from '@mui/icons-material/Clear';
import IconButton from '@mui/material/IconButton';
import Grid from '@mui/material/Grid';

import { StyledTableCell, StyledTableRow } from '../theme/TableTheme';

const Main = () => {

    return (
        <Grid container spacing={1}>
            <TableContainer component={Paper} sx={{ maxWidth: 800, mt: 1 }}>
            <Table sx={{ minWidth: 800 }} aria-label="simple table">
            <TableBody>
            <TableCell align="left">
            <> Сервис проксирования сетевых портов без выделения IP адреса для клиента.<br/>
                Скаченный клиент подключается к выделенному порту сервиса (Перенаправляемый порт).<br/>
                Пользователь подключается к сервису по другому порту (Входящий порт)<br/>
                <br/>
                Пример параметров подключения к сервису клиента:<br/>
                <b>module_net_port_client-0.0.0 --host_in 82.146.44.140 -p_in 6002 --host_out 127.0.0.1 -p_out 22</b><br/>
                где <b>--host_in</b> - адрес сервиса <br/>
                <b>-p_in</b> - входящий от сервиса порт (выданный сервисом - перенаправляемый порт сервиса)<br/>
                <b>--host_out</b> - адрес перенаправления клиента<br/>
                <b>-p_out</b> - порт перенаправления (22 порт - ssh)<br/>
            </>
            </TableCell>
            </TableBody> 
            </Table>
            </TableContainer>
            
            <TableContainer component={Paper} sx={{ maxWidth: 540, mt: 2 }}>
            <Table sx={{ minWidth: 450 }} aria-label="simple table">
            <TableHead>
            <TableRow
                sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
            >
            <StyledTableCell component="th" scope="row"><b>{"Доступные для скачивания клиенты "}</b></StyledTableCell>
            <StyledTableCell align="right">
            </StyledTableCell>
            </TableRow>
            </TableHead>
            <TableBody>
            <StyledTableRow
                sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
            >
                <TableCell component="th" scope="row">
                    <b>Клиент ARM 32 бит Linux</b>
                </TableCell>
                <TableCell align="right">{'нет'}</TableCell>
            </StyledTableRow>
            <StyledTableRow
                sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
            >
                <TableCell component="th" scope="row">
                    <b>Клиент ARM 64 бит Linux</b>
                </TableCell>
                <TableCell align="right">{'нет'}</TableCell>
            </StyledTableRow>
            <StyledTableRow
                sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
            >
                <TableCell component="th" scope="row">
                    <b>Клиент x64 Linux</b>
                </TableCell>
                <TableCell align="right">{'нет'}</TableCell>
            </StyledTableRow>
            </TableBody>
            </Table>
            </TableContainer>
        </Grid>
    );
};

export default Main;