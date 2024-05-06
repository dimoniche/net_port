import React, { useContext, useEffect, useState, lazy } from "react";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";

import TableContainer from "@mui/material/TableContainer";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import ClearIcon from "@mui/icons-material/Clear";
import IconButton from "@mui/material/IconButton";
import Grid from "@mui/material/Grid";

import { StyledTableCell, StyledTableRow } from "../theme/TableTheme";

import net_port from "../files/net_port.service";
import arm_linux_gnueabihf from "../files/module_net_port_client-0.0.1_arm-linux-gnueabihf";
import x64_arm_linux from "../files/module_net_port_client-0.0.1_x64-linux";
import x86_linux from "../files/module_net_port_client-0.0.1_x86-linux";

const Main = () => {
    return (
        <Grid container spacing={1}>
            <Grid item xs={12}>
                <TableContainer component={Paper} sx={{ maxWidth: 900, mt: 1 }}>
                    <Table sx={{ minWidth: 900 }} aria-label="simple table">
                        <TableBody>
                            <TableRow>
                                <TableCell align="left">
                                    <>
                                        {" "}
                                        Сервис форвардинга сетевых портов без
                                        выделения IP адреса для клиента.
                                        <br />
                                        Можно использовать для доступа к
                                        устройствам без выделенного белого IP
                                        адреса
                                        <br />
                                        с помощью установленного на устройстве
                                        клиента, который держит постоянное
                                        подключение к сервису.
                                        <br />
                                        Скаченный клиент подключается к
                                        выделенному порту сервиса
                                        (Перенаправляемый порт).
                                        <br />
                                        Пользователь подключается к сервису по
                                        другому порту (Входящий порт)
                                        <br />
                                        <br />
                                        Пример параметров подключения к сервису
                                        клиента:
                                        <br />
                                        <b>
                                            module_net_port_client-0.0.1
                                            --host_in 82.146.44.140 -p_in 6002
                                            --host_out 127.0.0.1 -p_out 22
                                        </b>
                                        <br />
                                        где <b>--host_in</b> - адрес сервиса{" "}
                                        <br />
                                        <b>-p_in</b> - входящий от сервиса порт
                                        (выданный сервисом - перенаправляемый
                                        порт сервиса)
                                        <br />
                                        <b>--host_out</b> - адрес
                                        перенаправления клиента
                                        <br />
                                        <b>-p_out</b> - порт перенаправления (22
                                        порт - ssh)
                                        <br />
                                    </>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </TableContainer>
            </Grid>
            <Grid item xs={12}></Grid>
            <Grid item xs={12}>
                <TableContainer component={Paper} sx={{ maxWidth: 900, mt: 2 }}>
                    <Table sx={{ minWidth: 900 }} aria-label="simple table">
                        <TableHead>
                            <TableRow
                                sx={{
                                    "&:last-child td, &:last-child th": {
                                        border: 0,
                                    },
                                }}
                            >
                                <StyledTableCell component="th" scope="row">
                                    <b>{"Доступные для скачивания клиенты "}</b>
                                </StyledTableCell>
                                <StyledTableCell align="right"></StyledTableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            <StyledTableRow
                                sx={{
                                    "&:last-child td, &:last-child th": {
                                        border: 0,
                                    },
                                }}
                            >
                                <TableCell component="th" scope="row">
                                    <b>Клиент ARM 32 бит Linux</b>
                                </TableCell>
                                <TableCell align="right">
                                    {
                                        <a
                                            href={arm_linux_gnueabihf}
                                            download="module_net_port_client-0.0.1"
                                        >
                                            {" "}
                                            module_net_port_client-0.0.1{" "}
                                        </a>
                                    }
                                </TableCell>
                            </StyledTableRow>
                            <StyledTableRow
                                sx={{
                                    "&:last-child td, &:last-child th": {
                                        border: 0,
                                    },
                                }}
                            >
                                <TableCell component="th" scope="row">
                                    <b>Клиент ARM 64 бит Linux</b>
                                </TableCell>
                                <TableCell align="right">{"нет"}</TableCell>
                            </StyledTableRow>
                            <StyledTableRow
                                sx={{
                                    "&:last-child td, &:last-child th": {
                                        border: 0,
                                    },
                                }}
                            >
                                <TableCell component="th" scope="row">
                                    <b>Клиент x86 Linux</b>
                                </TableCell>
                                <TableCell align="right">
                                    {
                                        <a
                                            href={x86_linux}
                                            download="module_net_port_client-0.0.1"
                                        >
                                            {" "}
                                            module_net_port_client-0.0.1{" "}
                                        </a>
                                    }
                                </TableCell>
                            </StyledTableRow>
                            <StyledTableRow
                                sx={{
                                    "&:last-child td, &:last-child th": {
                                        border: 0,
                                    },
                                }}
                            >
                                <TableCell component="th" scope="row">
                                    <b>Клиент x64 Linux</b>
                                </TableCell>
                                <TableCell align="right">
                                    {
                                        <a
                                            href={x64_arm_linux}
                                            download="module_net_port_client-0.0.1"
                                        >
                                            {" "}
                                            module_net_port_client-0.0.1{" "}
                                        </a>
                                    }
                                </TableCell>
                            </StyledTableRow>
                        </TableBody>
                    </Table>
                </TableContainer>
            </Grid>
            <Grid item xs={12}>
                <TableContainer component={Paper} sx={{ maxWidth: 900, mt: 2 }}>
                    <Table sx={{ minWidth: 900 }} aria-label="simple table">
                        <TableBody>
                            <TableRow>
                                <TableCell align="left">
                                    <>
                                        При запуске в ОС LInux, можно запускать
                                        клиент как сервис с помощью, например{" "}
                                        <a
                                            href={
                                                "https://ru.wikipedia.org/wiki/Systemd"
                                            }
                                        >
                                            {" "}
                                            system.d
                                        </a>
                                        <br />
                                        <br />
                                        <b>Пример запуска:</b>
                                        <br />
                                        Файл описания сервиса, c названием{" "}
                                        <a
                                            href={net_port}
                                            download="net_port.service"
                                        >
                                            {" "}
                                            net_port.service{" "}
                                        </a>
                                        :<br />
                                        <br />
                                        <b>[Unit]</b>
                                        <br />
                                        Description=net port service
                                        <br />
                                        <br />
                                        <b>[Service]</b>
                                        <br />
                                        WorkingDirectory=/home/pi/net_port
                                        <br />
                                        ExecStart=/home/pi/net_port/module_net_port_client-0.0.1
                                        --host_in 82.146.44.140 -p_in 6001
                                        --host_out 127.0.0.1 -p_out 22
                                        <br />
                                        User=pi
                                        <br />
                                        Type=simple
                                        <br />
                                        Restart=always
                                        <br />
                                        RestartSec=5
                                        <br />
                                        <b>[Install]</b>
                                        <br />
                                        WantedBy=multi-user.target
                                        <br />
                                        <br />
                                        <b>Для регистрации запуска сервиса:</b>
                                        <br />
                                        systemctl enable net_port
                                        <br />
                                        Затем запуск сервиса
                                        <br />
                                        systemctl start net_port
                                        <br />
                                    </>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </TableContainer>
            </Grid>
        </Grid>
    );
};

export default Main;
