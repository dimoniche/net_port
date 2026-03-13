import React, { useState, useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import isEmpty from "lodash/isEmpty";
import { useCookies } from "react-cookie";

import { ApiContext } from "../context/ApiContext";

import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TableContainer from "@mui/material/TableContainer";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Grid from "@mui/material/Grid";

import { Loader } from "../components/Loader";
import ServerSettingsData from "./ServerSettings/ServerSettingsData";
import ServerTableView from "./ServerSettings/ServerTableView";
import CommonDialog from "../components/CommonDialog";

import updateAbility from "../config/permission";

const Servers = ({ children, ...rest }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();

    const [isLoaded, setIsLoaded] = useState(false);
    const [serversData, setServersData] = useState();
    const history = useNavigate();

    // Filter states
    const [nameFilter, setNameFilter] = useState("");
    const [inputPortFilter, setInputPortFilter] = useState("");
    const [outputPortFilter, setInputOutputFilter] = useState("");
    const [enableFilter, setEnableFilter] = useState("");

    // Display settings - default to table view
    const [tableView, setTableView] = useState(true);

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

            if (isEmpty(cookies.user)) {
                history("/main");
                return;
            }

            const servers = await api
                .get(`/servers/0?user_id=${cookies.user.id}`, {
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

            if (servers.status === 200) {
                setServersData(servers.data);
                setIsLoaded(true);
            }
        }
        fetchData(abortController);

        return () => {
            //abortController.abort();
        };
    }, []);

    // Load display settings from localStorage
    useEffect(() => {
        const savedSettings = localStorage.getItem('serverDisplaySettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            setTableView(settings.tableView !== undefined ? settings.tableView : true); // Default to true if not set
        }
    }, []);

    // Filter servers based on filter criteria
    const getFilteredServers = () => {
        if (!serversData) return [];
        
        return serversData.filter(server => {
            // Name filter (description field) - substring match
            if (nameFilter && server.description && 
                !server.description.toLowerCase().includes(nameFilter.toLowerCase())) {
                return false;
            }
            
            // Input port filter - substring match
            if (inputPortFilter && server.input_port && 
                !server.input_port.toString().includes(inputPortFilter)) {
                return false;
            }
            
            // Output port filter - substring match
            if (outputPortFilter && server.output_port && 
                !server.output_port.toString().includes(outputPortFilter)) {
                return false;
            }
            
            // Enable status filter - substring match
            if (enableFilter !== "" && server.enable !== undefined) {
                const enableText = server.enable ? "true" : "false";
                if (!enableText.includes(enableFilter.toLowerCase())) {
                    return false;
                }
            }
            
            return true;
        });
    };

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

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
        updateAbility(rest.ability, null);
    };

    const restartServices = () => {
        var data;
        data = { user_id: cookies.user.id };

        try {
            api.put(`/servers/${serversData[0].id}`, data)
                .then((response) => {})
                .catch((error) => {
                    console.error(error.response);
                    if (error.response.status === 422) {
                    }
                    if (error.response.status === 401) {
                        handleLogout();
                    }
                });
        } catch (error) {
            setError(error);
            console.log(JSON.stringify(error.message));
        }
    };

    // Reset all filters
    const resetFilters = () => {
        setNameFilter("");
        setInputPortFilter("");
        setInputOutputFilter("");
        setEnableFilter("");
    };

    const filteredServers = getFilteredServers();

    return (
        <>
            {!isEmpty(cookies.user) ? (
                <Box sx={{ flexGrow: 1, mt: 2, width: '100%' }}>
                    <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                            <TableContainer component={Paper}>
                                <Table sx={{ minWidth: 300 }} aria-label="simple table">
                                    <TableBody>
                                        <TableRow
                                            sx={{
                                                "&:last-child td, &:last-child th": {
                                                    border: 0,
                                                },
                                            }}
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
                                                    onClick={() => {
                                                        newHandler();
                                                    }}
                                                    disabled={
                                                        cookies.user.role_name === "admin"
                                                            ? false
                                                            : !isEmpty(serversData)
                                                            ? serversData.length >= 5
                                                            : true
                                                    }
                                                >
                                                    Добавить
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                        <TableRow
                                            sx={{
                                                "&:last-child td, &:last-child th": {
                                                    border: 0,
                                                },
                                            }}
                                        >
                                            <TableCell component="th" scope="row">
                                                <b>Все службы</b>
                                            </TableCell>
                                            <TableCell align="right">
                                                <Button
                                                    color="primary"
                                                    size="large"
                                                    variant="contained"
                                                    type="submit"
                                                    onClick={() => {
                                                        restartServices();
                                                    }}
                                                    disabled={isEmpty(serversData)}
                                                >
                                                    Перезагрузить
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <Paper sx={{ p: 2, height: '100%' }}>
                                <Typography variant="h6" gutterBottom>
                                    Фильтры
                                </Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <TextField
                                        label="Название сервера"
                                        value={nameFilter}
                                        onChange={(e) => setNameFilter(e.target.value)}
                                        variant="outlined"
                                        size="small"
                                    />
                                    <Box sx={{ display: 'flex', gap: 2 }}>
                                        <TextField
                                            label="Порт (input)"
                                            value={inputPortFilter}
                                            onChange={(e) => setInputPortFilter(e.target.value)}
                                            variant="outlined"
                                            size="small"
                                            type="number"
                                            sx={{ flex: 1 }}
                                        />
                                        <TextField
                                            label="Порт (output)"
                                            value={outputPortFilter}
                                            onChange={(e) => setInputOutputFilter(e.target.value)}
                                            variant="outlined"
                                            size="small"
                                            type="number"
                                            sx={{ flex: 1 }}
                                        />
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 2 }}>
                                        <FormControl variant="outlined" size="small" sx={{ flex: 1 }}>
                                            <InputLabel>Статус сервера</InputLabel>
                                            <Select
                                                value={enableFilter}
                                                onChange={(e) => setEnableFilter(e.target.value)}
                                                label="Статус сервера"
                                            >
                                                <MenuItem value=""><em>Все</em></MenuItem>
                                                <MenuItem value="true">Включен</MenuItem>
                                                <MenuItem value="false">Отключен</MenuItem>
                                            </Select>
                                        </FormControl>
                                        <Button 
                                            variant="outlined" 
                                            onClick={resetFilters}
                                            sx={{ height: '40px' }}
                                        >
                                            Сбросить
                                        </Button>
                                    </Box>
                                </Box>
                            </Paper>
                        </Grid>
                    </Grid>
                </Box>
            ) : (
                <></>
            )}
            
            {isLoaded && !isEmpty(filteredServers) ? (
                <>
                    {tableView ? (
                        <ServerTableView 
                            serversData={filteredServers}
                            deleteHandler={deleteHandler}
                            editHandler={editHandler}
                        />
                    ) : (
                        filteredServers
                            .sort(function (a, b) {
                                return a.id - b.id;
                            })
                            .map((rs) => (
                                <ServerSettingsData
                                    key={rs.id}
                                    data={rs}
                                    editHandler={() => {
                                        editHandler(rs.id);
                                    }}
                                    removeHandle={() => {
                                        deleteHandler(rs.id);
                                    }}
                                />
                            ))
                    )}
                    <CommonDialog
                        open={open}
                        title={"Удаление сервера"}
                        text={
                            "Вы действительно уверены, что хотите удалить сервер?"
                        }
                        handleCancel={() => setOpen(false)}
                        handleSubmit={() => removeModalHandler()}
                    />
                </>
            ) : (
                <Loader title={"Доступных серверов нет"} />
            )}
        </>
    );
};

export default Servers;
