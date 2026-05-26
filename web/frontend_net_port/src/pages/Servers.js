import React, { useState, useContext, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import isEmpty from "lodash/isEmpty";
import { useCookies } from "react-cookie";

import { ApiContext } from "../context/ApiContext";

import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Grid from "@mui/material/Grid";
import Chip from "@mui/material/Chip";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";

import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

import { Loader } from "../components/Loader";
import ServerTableView from "./ServerSettings/ServerTableView";
import CommonDialog from "../components/CommonDialog";
import { useRealtimeSocket } from "../hooks/useRealtimeSocket";

import updateAbility from "../config/permission";

const Servers = ({ children, ...rest }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();

    const [isLoaded, setIsLoaded] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [serversData, setServersData] = useState([]);
    const history = useNavigate();

    const [nameFilter, setNameFilter] = useState("");
    const [inputPortFilter, setInputPortFilter] = useState("");
    const [outputPortFilter, setOutputPortFilter] = useState("");
    const [enableFilter, setEnableFilter] = useState("");

    const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
    const [serverToDelete, setServerToDelete] = useState(null);
    const [liveUpdatesEnabled, setLiveUpdatesEnabled] = useState(true);

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    const handleLogout = useCallback(() => {
        removeCookie("token");
        removeCookie("user");
        api.delete(`/authentication`).catch(() => {});
        history("/main");
        updateAbility(rest.ability, null);
    }, [api, history, removeCookie, rest.ability]);

    const fetchServers = useCallback(async (abortController) => {
        let responseError = false;
        setIsRefreshing(true);

        if (isEmpty(cookies.user)) {
            history("/main");
            setIsRefreshing(false);
            return;
        }

        const servers = await api
            .get(`/servers/0?user_id=${cookies.user.id}`, {
                signal: abortController?.signal,
            })
            .catch((err) => {
                if (err.response?.status === 401) {
                    handleLogout();
                } else {
                    setError(err);
                }
                responseError = true;
            });

        if (responseError) {
            setIsRefreshing(false);
            return;
        }
        if (abortController?.signal?.aborted) {
            setIsRefreshing(false);
            return;
        }

        if (servers.status === 200) {
            setServersData(Array.isArray(servers.data) ? servers.data : []);
            setIsLoaded(true);
        }
        setIsRefreshing(false);
    }, [api, cookies.user, handleLogout, history]);

    const realtimeHandlers = useMemo(
        () => ({
            "statistics:server-updated": () => {
                fetchServers();
            },
        }),
        [fetchServers]
    );

    useRealtimeSocket({
        token: cookies.token,
        enabled: liveUpdatesEnabled && !isEmpty(cookies.user),
        handlers: realtimeHandlers,
    });

    useEffect(() => {
        const abortController = new AbortController();
        fetchServers(abortController);
        return () => abortController.abort();
    }, [fetchServers]);

    const filteredServers = (serversData || []).filter((server) => {
        if (
            nameFilter &&
            server.description &&
            !server.description.toLowerCase().includes(nameFilter.toLowerCase())
        ) {
            return false;
        }

        if (
            inputPortFilter &&
            server.input_port &&
            !server.input_port.toString().includes(inputPortFilter)
        ) {
            return false;
        }

        if (
            outputPortFilter &&
            server.output_port &&
            !server.output_port.toString().includes(outputPortFilter)
        ) {
            return false;
        }

        if (enableFilter !== "" && server.enable !== undefined) {
            const enabled = enableFilter === "true";
            if (server.enable !== enabled) {
                return false;
            }
        }

        return true;
    });

    const canAddServer =
        cookies.user?.role_name === "admin" ||
        isEmpty(serversData) ||
        serversData.length < 5;

    const handleRestartAll = async () => {
        if (isEmpty(serversData)) {
            return;
        }

        try {
            await api.put(`/servers/${serversData[0].id}`, {
                user_id: cookies.user.id,
            });
            await fetchServers();
        } catch (err) {
            if (err.response?.status === 401) {
                handleLogout();
            } else {
                setError(err);
            }
        }
    };

    const openDeleteConfirm = (server) => {
        setServerToDelete(server);
        setOpenDeleteDialog(true);
    };

    const handleDeleteServer = async () => {
        if (!serverToDelete) {
            return;
        }

        try {
            const response = await api.delete(`/servers/${serverToDelete.id}`);
            if (response.status === 200) {
                setServersData(Array.isArray(response.data) ? response.data : []);
                setOpenDeleteDialog(false);
                setServerToDelete(null);
            }
        } catch (err) {
            if (err.response?.status === 401) {
                handleLogout();
            } else {
                setError(err);
            }
            setOpenDeleteDialog(false);
        }
    };

    if (!isLoaded) {
        return <Loader />;
    }

    return (
        <Grid container spacing={3}>
            <Grid item xs={12}>
                <Box
                    sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        mb: 2,
                        flexWrap: "wrap",
                        gap: 1,
                    }}
                >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                        <Typography variant="h4" sx={{ m: 0 }}>
                            Серверы
                        </Typography>
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => history("/servers/new")}
                            disabled={!canAddServer}
                        >
                            Добавить сервер
                        </Button>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto" }}>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<RefreshIcon />}
                            onClick={() => fetchServers()}
                            disabled={isRefreshing}
                        >
                            {isRefreshing ? "Обновление..." : "Обновить"}
                        </Button>
                        <Chip
                            label={liveUpdatesEnabled ? "Live: ВКЛ" : "Live: ВЫКЛ"}
                            color={liveUpdatesEnabled ? "success" : "default"}
                            onClick={() => setLiveUpdatesEnabled((value) => !value)}
                            sx={{ cursor: "pointer" }}
                        />
                    </Box>
                </Box>
            </Grid>

            <Grid item xs={12}>
                <Card>
                    <CardContent>
                        <Box
                            sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                flexWrap: "wrap",
                                gap: 1,
                            }}
                        >
                            <Box>
                                <Typography variant="h6" gutterBottom sx={{ mb: 0.5 }}>
                                    Перезагрузка служб
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Перезапускает все legacy-службы net_port для текущего пользователя.
                                </Typography>
                            </Box>
                            <Button
                                variant="outlined"
                                color="primary"
                                startIcon={<RestartAltIcon />}
                                onClick={handleRestartAll}
                                disabled={isEmpty(serversData)}
                            >
                                Перезагрузить все
                            </Button>
                        </Box>
                    </CardContent>
                </Card>
            </Grid>

            <Grid item xs={12}>
                <Paper sx={{ p: 1, mb: 1.5 }}>
                    <Typography variant="subtitle1" sx={{ fontSize: "0.95rem", mb: 1 }}>
                        Фильтры
                    </Typography>
                    <Grid container spacing={1}>
                        <Grid item xs={12} sm={3}>
                            <TextField
                                fullWidth
                                label="Название"
                                value={nameFilter}
                                onChange={(e) => setNameFilter(e.target.value)}
                                size="small"
                                sx={{ "& .MuiInputBase-root": { fontSize: "0.875rem" } }}
                            />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <TextField
                                fullWidth
                                label="Входящий порт"
                                value={inputPortFilter}
                                onChange={(e) => setInputPortFilter(e.target.value)}
                                size="small"
                                type="number"
                                sx={{ "& .MuiInputBase-root": { fontSize: "0.875rem" } }}
                            />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <TextField
                                fullWidth
                                label="Исходящий порт"
                                value={outputPortFilter}
                                onChange={(e) => setOutputPortFilter(e.target.value)}
                                size="small"
                                type="number"
                                sx={{ "& .MuiInputBase-root": { fontSize: "0.875rem" } }}
                            />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <FormControl fullWidth size="small">
                                <InputLabel sx={{ fontSize: "0.875rem" }}>Статус</InputLabel>
                                <Select
                                    value={enableFilter}
                                    label="Статус"
                                    onChange={(e) => setEnableFilter(e.target.value)}
                                    sx={{ fontSize: "0.875rem" }}
                                >
                                    <MenuItem value="" sx={{ fontSize: "0.875rem" }}>
                                        Все
                                    </MenuItem>
                                    <MenuItem value="true" sx={{ fontSize: "0.875rem" }}>
                                        Включен
                                    </MenuItem>
                                    <MenuItem value="false" sx={{ fontSize: "0.875rem" }}>
                                        Отключен
                                    </MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>
                </Paper>
            </Grid>

            <Grid item xs={12}>
                <ServerTableView
                    serversData={filteredServers}
                    onEdit={(id) => history(`/servers/edit/${id}`)}
                    onDelete={openDeleteConfirm}
                />
            </Grid>

            <CommonDialog
                open={openDeleteDialog}
                title="Удаление сервера"
                text={`Вы уверены, что хотите удалить сервер "${serverToDelete?.description || serverToDelete?.id}"?`}
                handleCancel={() => {
                    setOpenDeleteDialog(false);
                    setServerToDelete(null);
                }}
                handleSubmit={handleDeleteServer}
            />
        </Grid>
    );
};

export default Servers;
