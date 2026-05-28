import React, { useState, useContext, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import isEmpty from "lodash/isEmpty";
import { useCookies } from "react-cookie";

import { ApiContext } from "../context/ApiContext";
import { formatTimestamp } from "../utils/statsFormat";
import { DEVICE_TYPES, getDeviceTypeLabel } from "../consts/deviceTypes";

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
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";

import RefreshIcon from "@mui/icons-material/Refresh";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

import { Loader } from "../components/Loader";
import CommonDialog from "../components/CommonDialog";
import DevicePortBadges from "../components/DevicePortBadges";
import { useDeviceStatusSocket } from "../hooks/useDeviceStatusSocket";

import updateAbility from "../config/permission";
import { CLIENT_BINARY_NAME } from "../consts/client";

const buildDeviceClientCommand = ({
    deviceId,
    token,
    internalPort,
    internalAddress,
}) => {
    const base = `./${CLIENT_BINARY_NAME} --device-id ${deviceId} --device-token ${token} --registration-server SERVER_IP --registration-port 8443 --port-host-base 49000`;

    if (internalPort) {
        if (internalAddress && internalAddress !== "127.0.0.1") {
            return `${base} --host_out ${internalAddress}`;
        }
        return base;
    }

    return `${base} --host_out ${internalAddress || "127.0.0.1"} -p_out 22`;
};

const Devices = ({ children, ...rest }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();
    const [isLoaded, setIsLoaded] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [devicesData, setDevicesData] = useState([]);
    const history = useNavigate();
    const location = useLocation();
    const [tokenNotice, setTokenNotice] = useState(null);

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
    const [liveUpdatesEnabled, setLiveUpdatesEnabled] = useState(true);
    if (error) {
        throw error;
    }

    const mergeDeviceUpdate = useCallback((updatedDevice) => {
        if (!updatedDevice?.id) {
            return;
        }

        setDevicesData((prev) => {
            const index = prev.findIndex((item) => item.id === updatedDevice.id);
            if (index === -1) {
                return [...prev, updatedDevice];
            }

            const next = [...prev];
            next[index] = { ...next[index], ...updatedDevice };
            return next;
        });
    }, []);

    const removeDeviceFromList = useCallback((removedDevice) => {
        if (!removedDevice?.id) {
            return;
        }

        setDevicesData((prev) => prev.filter((item) => item.id !== removedDevice.id));
    }, []);

    useDeviceStatusSocket({
        token: cookies.token,
        enabled: liveUpdatesEnabled && !isEmpty(cookies.user),
        onDeviceUpdated: mergeDeviceUpdate,
        onDeviceRemoved: removeDeviceFromList,
    });

    const fetchDevices = async (abortController) => {
        let response_error = false;
        setIsRefreshing(true);

        if (isEmpty(cookies.user)) {
            history("/main");
            setIsRefreshing(false);
            return;
        }

        // Build query params
        const params = new URLSearchParams();
        if (deviceIdFilter) params.append("search", deviceIdFilter);
        if (statusFilter) params.append("status", statusFilter);
        if (typeFilter) params.append("type", typeFilter);

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

        if (response_error) {
            setIsRefreshing(false);
            return;
        }
        if (abortController?.signal?.aborted) {
            setIsRefreshing(false);
            return;
        }

        if (devices.status === 200) {
            // Handle paginated response (data is { data: [], limit, skip, total })
            const devicesArray = devices.data.data || devices.data;
            setDevicesData(devicesArray);
            setIsLoaded(true);
        }
        setIsRefreshing(false);
    };

    useEffect(() => {
        if (location.state?.authToken && location.state?.newDevice) {
            setTokenNotice({
                deviceId: location.state.newDevice,
                token: location.state.authToken,
                internalPort: location.state.internalPort || null,
                internalAddress: location.state.internalAddress || null,
            });
            history(location.pathname, { replace: true, state: {} });
        }
    }, [location.state, location.pathname, history]);

    useEffect(() => {
        const abortController = new AbortController();
        fetchDevices(abortController);

        api.get("/settings/auto-connect", { signal: abortController.signal })
            .then((response) => {
                if (response.status === 200) {
                    setAutoConnectEnabled(response.data.enabled !== false);
                }
            })
            .catch(() => {});

        return () => {
            abortController.abort();
        };
    }, []);

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
        updateAbility(rest.ability, null);
    };

    const handleAutoConnectToggle = async () => {
        const nextValue = !autoConnectEnabled;
        setAutoConnectEnabled(nextValue);

        try {
            await api.patch("/settings/auto-connect", { enabled: nextValue });
        } catch (error) {
            setAutoConnectEnabled(!nextValue);
            console.error("Failed to save auto-connect setting:", error);
        }
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
            case "pending":
                return "info";
            case "blocked":
                return "error";
            default:
                return "default";
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return "Никогда";
        return formatTimestamp(dateString, { withSeconds: true });
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
                {tokenNotice && (
                    <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setTokenNotice(null)}>
                        <AlertTitle>Токен устройства {tokenNotice.deviceId}</AlertTitle>
                        Сохраните токен — он показывается один раз: <strong>{tokenNotice.token}</strong>
                        <Box sx={{ mt: 1, fontFamily: "monospace", fontSize: "0.85rem" }}>
                            {buildDeviceClientCommand({
                                deviceId: tokenNotice.deviceId,
                                token: tokenNotice.token,
                                internalPort: tokenNotice.internalPort,
                                internalAddress: tokenNotice.internalAddress,
                            })}
                        </Box>
                    </Alert>
                )}
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
                            Устройства
                        </Typography>
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => history("/devices/new")}
                        >
                            Добавить устройство
                        </Button>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto" }}>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<RefreshIcon />}
                            onClick={() => fetchDevices()}
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
                                    Авто-подключение
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    При включенном авто-подключении система автоматически пытается
                                    восстановить соединение с устройствами при потере связи.
                                    {autoConnectEnabled
                                        ? " Сейчас функция активна."
                                        : " Сейчас функция отключена."}
                                </Typography>
                            </Box>
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
                                        {autoConnectEnabled ? "ВКЛ" : "ВЫКЛ"}
                                    </Typography>
                                }
                            />
                        </Box>
                    </CardContent>
                </Card>
            </Grid>

            <Grid item xs={12}>
                <Paper sx={{ p: 1, mb: 1.5 }}>
                    <Typography variant="subtitle1" sx={{ fontSize: '0.95rem', mb: 1 }}>
                        Фильтры
                    </Typography>
                    <Grid container spacing={1}>
                        <Grid item xs={12} sm={3}>
                            <TextField
                                fullWidth
                                label="ID устройства"
                                value={deviceIdFilter}
                                onChange={(e) => setDeviceIdFilter(e.target.value)}
                                size="small"
                                sx={{ '& .MuiInputBase-root': { fontSize: '0.875rem' } }}
                            />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <TextField
                                fullWidth
                                label="Название"
                                value={nameFilter}
                                onChange={(e) => setNameFilter(e.target.value)}
                                size="small"
                                sx={{ '& .MuiInputBase-root': { fontSize: '0.875rem' } }}
                            />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <FormControl fullWidth size="small">
                                <InputLabel sx={{ fontSize: '0.875rem' }}>Статус</InputLabel>
                                <Select
                                    value={statusFilter}
                                    label="Статус"
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    sx={{ fontSize: '0.875rem' }}
                                >
                                    <MenuItem value="" sx={{ fontSize: '0.875rem' }}>Все</MenuItem>
                                    <MenuItem value="active" sx={{ fontSize: '0.875rem' }}>Активен</MenuItem>
                                    <MenuItem value="inactive" sx={{ fontSize: '0.875rem' }}>Неактивен</MenuItem>
                                    <MenuItem value="connecting" sx={{ fontSize: '0.875rem' }}>Подключается</MenuItem>
                                    <MenuItem value="error" sx={{ fontSize: '0.875rem' }}>Ошибка</MenuItem>
                                    <MenuItem value="pending" sx={{ fontSize: '0.875rem' }}>Ожидает</MenuItem>
                                    <MenuItem value="blocked" sx={{ fontSize: '0.875rem' }}>Заблокирован</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <FormControl fullWidth size="small">
                                <InputLabel sx={{ fontSize: '0.875rem' }}>Тип</InputLabel>
                                <Select
                                    value={typeFilter}
                                    label="Тип"
                                    onChange={(e) => setTypeFilter(e.target.value)}
                                    sx={{ fontSize: '0.875rem' }}
                                >
                                    <MenuItem value="" sx={{ fontSize: '0.875rem' }}>Все</MenuItem>
                                    {DEVICE_TYPES.map(({ value, label }) => (
                                        <MenuItem key={value} value={value} sx={{ fontSize: '0.875rem' }}>
                                            {label}
                                        </MenuItem>
                                    ))}
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
                                <TableCell sx={{ minWidth: 110 }}>Назначенный порт</TableCell>
                                <TableCell>Внутренний порт</TableCell>
                                <TableCell>Последняя активность</TableCell>
                                <TableCell>Действия</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredDevices.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} align="center">
                                        Нет устройств
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredDevices.map((device) => (
                                    <TableRow key={device.id}>
                                        <TableCell>{device.device_id}</TableCell>
                                        <TableCell>{device.name || "-"}</TableCell>
                                        <TableCell>{getDeviceTypeLabel(device.type)}</TableCell>
                                        <TableCell sx={{ verticalAlign: "top" }}>
                                            <Box
                                                sx={{
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: "stretch",
                                                    gap: 0.5,
                                                    width: 72,
                                                }}
                                            >
                                                <Chip
                                                    label={device.status || "unknown"}
                                                    color={getStatusColor(device.status)}
                                                    size="small"
                                                    sx={{ justifyContent: "center" }}
                                                />
                                                {device.online && (
                                                    <Chip
                                                        label="online"
                                                        color="success"
                                                        size="small"
                                                        sx={{ justifyContent: "center" }}
                                                    />
                                                )}
                                            </Box>
                                        </TableCell>
                                        <TableCell sx={{ verticalAlign: "top", minWidth: 110, whiteSpace: "normal" }}>
                                            <DevicePortBadges device={device} />
                                        </TableCell>
                                        <TableCell>
                                            {device.internal_port || "-"}
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
                                                        disabled={device.status === "pending" && !device.auth_token}
                                                    >
                                                        {device.status === "inactive" || device.status === "pending"
                                                            ? "Разрешить"
                                                            : "Подключить"}
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