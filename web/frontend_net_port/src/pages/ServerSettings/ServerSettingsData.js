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

const ServerSettingsData = ({ data, editHandler }) => (
    <>
        <TableContainer component={Paper} sx={{ maxWidth: 540, mt: 2 }}>
            <Table sx={{ minWidth: 450 }} aria-label="simple table">
                <TableHead>
                    <TableRow
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                    >
                        <StyledTableCell component="th" scope="row"><b>{"Настройки сервера " + (data.description || '')}</b></StyledTableCell>
                        <StyledTableCell align="right"></StyledTableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    <StyledTableRow
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                    >
                        <TableCell component="th" scope="row">
                            <b>Входящий порт</b>
                        </TableCell>
                        <TableCell align="right">{data.input_port || '---'}</TableCell>
                    </StyledTableRow>
                    <StyledTableRow
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                    >
                        <TableCell component="th" scope="row">
                            <b>Перенаправляемый порт</b>
                        </TableCell>
                        <TableCell align="right">{data.output_port || '---'}</TableCell>
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
                        <TableCell component="th" scope="row">
                            <Button
                                sx={{
                                    mt: 2,
                                }}
                                variant="outlined"
                                onClick={editHandler}
                            >
                                Статистика
                            </Button>
                        </TableCell>
                    </StyledTableRow>
                </TableBody>
            </Table>
        </TableContainer>
    </>
);

export default ServerSettingsData;
