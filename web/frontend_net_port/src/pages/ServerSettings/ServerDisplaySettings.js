import React, { useState, useEffect } from "react";
import { useCookies } from "react-cookie";

import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TableContainer from "@mui/material/TableContainer";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { StyledTableCell, StyledTableRow } from '../../theme/TableTheme';

const ServerDisplaySettings = ({ ability }) => {
    const [cookies] = useCookies();
    const [tableView, setTableView] = useState(true); // Changed default to true

    // Load settings from localStorage on component mount
    useEffect(() => {
        const savedSettings = localStorage.getItem('serverDisplaySettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            setTableView(settings.tableView !== undefined ? settings.tableView : true); // Default to true if not set
        }
    }, []);

    // Save settings to localStorage whenever they change
    const saveSettings = (newTableView) => {
        const settings = {
            tableView: newTableView
        };
        localStorage.setItem('serverDisplaySettings', JSON.stringify(settings));
    };

    const handleTableViewChange = (event) => {
        const newValue = event.target.checked;
        setTableView(newValue);
        saveSettings(newValue);
    };

    return (
        <>
            <TableContainer component={Paper} sx={{ maxWidth: 540, mt: 2 }}>
                <Table sx={{ minWidth: 450 }} aria-label="simple table">
                    <TableHead>
                        <TableRow
                            sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                        >
                            <StyledTableCell component="th" scope="row">
                                <b>Настройки отображения серверов</b>
                            </StyledTableCell>
                            <StyledTableCell align="right"></StyledTableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        <StyledTableRow
                            sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                        >
                            <TableCell component="th" scope="row">
                                <b>Табличный вид</b>
                            </TableCell>
                            <TableCell align="right">
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={tableView}
                                            onChange={handleTableViewChange}
                                            color="primary"
                                        />
                                    }
                                    label={tableView ? "Включен" : "Выключен"}
                                />
                            </TableCell>
                        </StyledTableRow>
                        <TableRow
                            sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                        >
                            <TableCell colSpan={2}>
                                <Box sx={{ p: 2 }}>
                                    <Typography variant="body2" color="textSecondary">
                                        При включении табличного вида список серверов будет отображаться в виде таблицы вместо карточек.
                                    </Typography>
                                </Box>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </TableContainer>
        </>
    );
};

export default ServerDisplaySettings;