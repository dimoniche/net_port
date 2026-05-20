import React, { useState, useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import isEmpty from "lodash/isEmpty";
import { useCookies } from "react-cookie";

import { ApiContext } from "../context/ApiContext";

import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TableContainer from "@mui/material/TableContainer";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
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
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";

import RefreshIcon from "@mui/icons-material/Refresh";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

import { Loader } from "../components/Loader";
import CommonDialog from "../components/CommonDialog";

import updateAbility from "../config/permission";

const Devices = ({ children, ...rest }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();
    const [isLoaded, setIsLoaded] = useState(false);
    const [devicesData, setDevicesData] = useState([]);
    const history = useNavigate();

    // Filter states
    const [deviceIdFilter, setDeviceIdFilter] = useState("");
    const [nameFilter, setNameFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState("");

    // Auto-connect setting
    const [autoConnectEnabled, setAutoConnectEnabled] = useState(true);

    // Dialog states
    const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
    const [deviceToDelete, setDeviceToDelete] = useState(null);

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    const fetchDevices = async (abortController) => {
        let response_error = false;

        if (isEmpty(cookies.user)) {
            history("/main");
            return;
        }

        // Build query params
        const params = new URLSearchParams();
        if (deviceIdFilter) params.append("search", deviceIdFilter);
        if (statusFilter) params.append("status", statusFilter);
        if (typeFilter) params.append("type", typeFilter);
        if (cookies.user?.id) params.append("user_id", cookies.user.id);

        const queryString = params.toString();
        const url = `/devices${queryString ? `?${queryString}` : ""}`;

        const devices = await api
            .get(url, {
                signal: abortController?.signal,
            })
            .catch((err) => {
                if (err.response?.status === 401) {
                    handleLogout();
                } else {
                    setError(err);
                }
                response_error = true;
            });

        if (response_error) return;
        if (abortController?.signal?.aborted) return;

        if (devices.status === 200) {
            setDevicesData(devices.data);
            setIsLoaded(true);
        }
    };

    useEffect(() => {
        const abortController = new AbortController();
        fetchDevices(abortController);

        // Poll for updates every 10 seconds
        const interval = setInterval(() => {
            fetchDevices();
        }, 10000);

        return () => {
            abortController.abort();
            clearInterval(interval);
        };
    }, []);

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
        updateAbility(rest.ability, null);
    };

    const handleAutoConnectToggle = () => {
        setAutoConnectEnabled(!autoConnectEnabled);
        // TODO: Save setting to backend
        // api.patch('/settings/auto-connect', { enabled: !autoConnectEnabled });
    };

    const handleConnectDevice = async (deviceId) => {
        try {
            await api.post(`/devices/${deviceId}/connect`);
            fetchDevices(); // Refresh list
        } catch (error) {
            console.error("Failed to connect device:", error);
        }
    };

    const handleDisconnectDevice = async (deviceId) => {
        try {
            await api.post(`/devices/${deviceId}/disconnect`);
            fetchDevices();
        } catch (error) {
            console.error("Failed to disconnect device:", error);
        }
    };

    const handleDeleteDevice = async (deviceId) => {
        try {
            await api.delete(`/devices/${deviceId}`);
            fetchDevices();
            setOpenDeleteDialog(false);
            setDeviceToDelete(null);
        } catch (error) {
            console.error("Failed to delete device:", error);
        }
    };

    const openDeleteConfirm = (device) => {
        setDeviceToDelete(device);
        setOpenDeleteDialog(true);
    };

    const getStatusColor = (status) => {
        switch (status) {
            case "active":
                return "success";
            case "inactive":
                return "default";
            case "connecting":
                return "warning";
            case "error":
                return "error";
            default:
                return "default";
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return "Никогда";
        const date = new Date(dateString);
        return date.toLocaleString("ru-RU");
    };

    const filteredDevices = devicesData.filter((device) => {
        if (deviceIdFilter && !device.device_id?.toLowerCase().includes(deviceIdFilter.toLowerCase())) {
            return false;
        }
        if (nameFilter && !device.name?.toLowerCase().includes(nameFilter.toLowerCase())) {
            return false;
        }
        if (statusFilter && device.status !== statusFilter) {
            return false;
        }
        if (typeFilter && device.type !== typeFilter) {
            return false;
        }
        return true;
    });

    if (!isLoaded) {
        return <Loader />;
    }

    return (
        <Grid container spacing={3}>
            <Grid item xs={12}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="h4">Устройства</Typography>
                    <Box>
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            sx={{ mr: 2 }}
                            onClick={() => history("/devices/new")}
                        >
                            Добавить устройство
                        </Button>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={autoConnectEnabled}
                                    onChange={handleAutoConnectToggle}
                                    color="primary"
                                />
                            }
                            label={
                                <Typography variant="body2">
                                    Авто-подключение: {autoConnectEnabled ? "ВКЛ" : "ВЫКЛ"}
                                </Typography>
                            }
                        />
                        <Tooltip title="Обновить">
                            <IconButton onClick={() => fetchDevices()} sx={{ ml: 1 }}>
                                <RefreshIcon />
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Box>
            </Grid>

            <Grid item xs={12}>
                <Card>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>
                            Статус авто-подключения
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            При включенном авто-подключении система автоматически пытается
                            восстановить соединение с устройствами при потере связи.
                            {autoConnectEnabled
                                ? " Сейчас функция активна."
                                : " Сейчас функция отключена."}
                        </Typography>
                    </CardContent>
                </Card>
            </Grid>

            <Grid item xs={12}>
                <Paper sx={{ p: 2, mb: 2 }}>
                    <Typography variant="h6" gutterBottom>
                        Фильтры
                    </Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={3}>
                            <TextField
                                fullWidth
                                label="ID устройства"
                                value={deviceIdFilter}
                                onChange={(e) => setDeviceIdFilter(e.target.value)}
                                size="small"
                            />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <TextField
                                fullWidth
                                label="Название"
                                value={nameFilter}
                                onChange={(e) => setNameFilter(e.target.value)}
                                size="small"
                            />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Статус</InputLabel>
                                <Select
                                    value={statusFilter}
                                    label="Статус"
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                >
                                    <MenuItem value="">Все</MenuItem>
                                    <MenuItem value="active">Активен</MenuItem>
                                    <MenuItem value="inactive">Неактивен</MenuItem>
                                    <MenuItem value="connecting">Подключается</MenuItem>
                                    <MenuItem value="error">Ошибка</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Тип</InputLabel>
                                <Select
                                    value={typeFilter}
                                    label="Тип"
                                    onChange={(e) => setTypeFilter(e.target.value)}
                                >
                                    <MenuItem value="">Все</MenuItem>
                                    <MenuItem value="iot_gateway">IoT Шлюз</MenuItem>
                                    <MenuItem value="sensor">Датчик</MenuItem>
                                    <MenuItem value="camera">Камера</MenuItem>
                                    <MenuItem value="router">Роутер</MenuItem>
                                    <MenuItem value="other">Другое</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>
                </Paper>
            </Grid>

            <Grid item xs={12}>
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>ID устройства</TableCell>
                                <TableCell>Название</TableCell>
                                <TableCell>Тип</TableCell>
                                <TableCell>Статус</TableCell>
                                <TableCell>Назначенный порт</TableCell>
                                <TableCell>Последняя активность</TableCell>
                                <TableCell>Действия</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredDevices.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} align="center">
                                        Нет устройств
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredDevices.map((device) => (
                                    <TableRow key={device.id}>
                                        <TableCell>{device.device_id}</TableCell>
                                        <TableCell>{device.name || "-"}</TableCell>
                                        <TableCell>{device.type || "-"}</TableCell>
                                        <TableCell>
                                            <Chip
                                                label={device.status || "unknown"}
                                                color={getStatusColor(device.status)}
                                                size="small"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            {device.assigned_port || device.session_port || "Не назначен"}
                                        </TableCell>
                                        <TableCell>
                                            {formatDate(device.last_heartbeat || device.last_activity)}
                                        </TableCell>
                                        <TableCell>
                                            <Box display="flex" gap={1}>
                                                {device.status === "active" ? (
                                                    <Button
                                                        variant="outlined"
                                                        color="error"
                                                        size="small"
                                                        startIcon={<PowerSettingsNewIcon />}
                                                        onClick={() => handleDisconnectDevice(device.id)}
                                                    >
                                                        Отключить
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        variant="outlined"
                                                        color="success"
                                                        size="small"
                                                        startIcon={<PowerSettingsNewIcon />}
                                                        onClick={() => handleConnectDevice(device.id)}
                                                    >
                                                        Подключить
                                                    </Button>
                                                )}
                                                <Tooltip title="Редактировать">
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => history(`/devices/edit/${device.id}`)}
                                                    >
                                                        <EditIcon />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Удалить">
                                                    <IconButton
                                                        size="small"
                                                        color="error"
                                                        onClick={() => openDeleteConfirm(device)}
                                                    >
                                                        <DeleteIcon />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Grid>

            <CommonDialog
                open={openDeleteDialog}
                title="Удаление устройства"
                text={`Вы уверены, что хотите удалить устройство "${deviceToDelete?.name || deviceToDelete?.device_id}"?`}
                handleCancel={() => {
                    setOpenDeleteDialog(false);
                    setDeviceToDelete(null);
                }}
                handleSubmit={() => handleDeleteDevice(deviceToDelete?.id)}
            />
        </Grid>
    );
};

export default Devices;