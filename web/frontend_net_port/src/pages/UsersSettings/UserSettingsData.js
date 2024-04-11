import React from 'react';

import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';

import TableContainer from '@mui/material/TableContainer';
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';

import { StyledTableCell, StyledTableRow } from '../../theme/TableTheme';

const UserSettingsData = ({ data, editHandler }) => (
    <>
        <TableContainer component={Paper} sx={{ maxWidth: 540, mt: 2 }}>
            <Table sx={{ minWidth: 450 }} aria-label="simple table">
                <TableHead>
                    <TableRow
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                    >
                        <StyledTableCell component="th" scope="row"><b>{"Настройки пользователя"}</b></StyledTableCell>
                        <StyledTableCell align="right"></StyledTableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    <StyledTableRow
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                    >
                        <TableCell component="th" scope="row">
                            <b>Логин</b>
                        </TableCell>
                        <TableCell align="right">{data.login || '---'}</TableCell>
                    </StyledTableRow>
                    <StyledTableRow
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                    >
                        <TableCell component="th" scope="row">
                            <b>Имя</b>
                        </TableCell>
                        <TableCell align="right">{data.username || '---'}</TableCell>
                    </StyledTableRow>
                    <StyledTableRow
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                    >
                        <TableCell component="th" scope="row">
                            <b>Почта</b>
                        </TableCell>
                        <TableCell align="right">{data.email || '---'}</TableCell>
                    </StyledTableRow>
                    <StyledTableRow
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                    >
                        <TableCell component="th" scope="row">
                            <b>Телефон</b>
                        </TableCell>
                        <TableCell align="right">{data.phone || '---'}</TableCell>
                    </StyledTableRow>
                    <StyledTableRow
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                    >
                        <TableCell component="th" scope="row">
                            <Button
                                sx={{
                                    mt: 2,
                                }}
                                variant="outlined"
                                onClick={editHandler}
                            >
                                Редактировать
                            </Button>
                        </TableCell>
                    </StyledTableRow>
                </TableBody>
            </Table>
        </TableContainer>
    </>
);

export { UserSettingsData };
