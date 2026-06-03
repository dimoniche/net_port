import React from "react";

import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

import { StyledTableCell, StyledTableRow } from "../../theme/TableTheme";

const ServerTableView = ({ serversData, onEdit, onDelete }) => {
    return (
        <TableContainer component={Paper}>
            <Table size="small" sx={{ minWidth: 650 }} aria-label="servers table">
                <TableHead>
                    <TableRow>
                        <StyledTableCell>Описание</StyledTableCell>
                        <StyledTableCell align="right">Входящий порт</StyledTableCell>
                        <StyledTableCell align="right">Исходящий порт</StyledTableCell>
                        <StyledTableCell>Статус</StyledTableCell>
                        <StyledTableCell align="center">SSL вход</StyledTableCell>
                        <StyledTableCell align="center">SSL выход</StyledTableCell>
                        <StyledTableCell>Действия</StyledTableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {serversData.length === 0 ? (
                        <StyledTableRow>
                            <TableCell colSpan={7} align="center">
                                Нет серверов
                            </TableCell>
                        </StyledTableRow>
                    ) : (
                        serversData
                            .slice()
                            .sort((a, b) => a.id - b.id)
                            .map((server) => (
                                <StyledTableRow key={server.id} hover>
                                    <TableCell>
                                        {server.description || `Сервер ${server.id}`}
                                    </TableCell>
                                    <TableCell align="right">
                                        {server.input_port || "-"}
                                    </TableCell>
                                    <TableCell align="right">
                                        {server.output_port || "-"}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={server.enable ? "включен" : "отключен"}
                                            color={server.enable ? "success" : "default"}
                                            size="small"
                                        />
                                    </TableCell>
                                    <TableCell align="center">
                                        <Chip
                                            label={server.enable_input_ssl ? "Да" : "Нет"}
                                            size="small"
                                            variant="outlined"
                                            color={server.enable_input_ssl ? "info" : "default"}
                                        />
                                    </TableCell>
                                    <TableCell align="center">
                                        <Chip
                                            label={server.enable_ssl ? "Да" : "Нет"}
                                            size="small"
                                            variant="outlined"
                                            color={server.enable_ssl ? "info" : "default"}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Box display="flex" gap={0.5}>
                                            <Tooltip title="Редактировать">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => onEdit(server.id)}
                                                >
                                                    <EditIcon />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Удалить">
                                                <IconButton
                                                    size="small"
                                                    color="error"
                                                    onClick={() => onDelete(server)}
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    </TableCell>
                                </StyledTableRow>
                            ))
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default ServerTableView;
