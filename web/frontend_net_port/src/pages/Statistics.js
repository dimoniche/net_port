import React, { useState, useContext, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import isEmpty from "lodash/isEmpty";
import { useCookies } from "react-cookie";

import { ApiContext } from "../context/ApiContext";

import Paper from "@mui/material/Paper";
import TableContainer from "@mui/material/TableContainer";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import IconButton from "@mui/material/IconButton";
import { Loader } from "../components/Loader";
import ServerStatsModal from "../components/ServerStatsModal";
import DeviceStatsModal from "../components/DeviceStatsModal";
import { useRealtimeSocket } from "../hooks/useRealtimeSocket";
import { formatTimestamp } from "../utils/statsFormat";

const Statistics = ({ children, ...rest }) => {
    const { api } = useContext(ApiContext);
    const [cookies, , removeCookie] = useCookies();

    const [tab, setTab] = useState(0);
    const [isLoaded, setIsLoaded] = useState(false);
    const [statisticsData, setStatisticsData] = useState([]);
    const [serversData, setServersData] = useState([]);
    const [deviceStatisticsData, setDeviceStatisticsData] = useState([]);
    const [selectedServer, setSelectedServer] = useState(null);
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [deviceModalOpen, setDeviceModalOpen] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [liveUpdatesEnabled, setLiveUpdatesEnabled] = useState(true);
    const history = useNavigate();

    const [error, setError] = useState(null);
    if (error) {
        throw error;
    }

    const mergeServerStatistics = useCallback((updatedStat) => {
        if (!updatedStat?.server_id) {
            return;
        }

        setStatisticsData((prev) => {
            const index = prev.findIndex(
                (item) => Number(item.server_id) === Number(updatedStat.server_id)
            );

            if (index === -1) {
                return [...prev, updatedStat];
            }

            const next = [...prev];
            next[index] = { ...next[index], ...updatedStat };
            return next;
        });
    }, []);

    const mergeDeviceStatistics = useCallback((updatedDevice) => {
        if (!updatedDevice?.id) {
            return;
        }

        setDeviceStatisticsData((prev) => {
            const index = prev.findIndex((item) => item.id === updatedDevice.id);

            if (index === -1) {
                return [...prev, updatedDevice];
            }

            const next = [...prev];
            next[index] = { ...next[index], ...updatedDevice };
            return next;
        });
    }, []);

    const realtimeHandlers = useMemo(() => ({
        'statistics:server-updated': mergeServerStatistics,
        'statistics:device-updated': mergeDeviceStatistics,
    }), [mergeServerStatistics, mergeDeviceStatistics]);

    useRealtimeSocket({
        token: cookies.token,
        enabled: liveUpdatesEnabled && !isEmpty(cookies.user),
        handlers: realtimeHandlers,
    });

    const fetchServerStatistics = async () => {
        const statistics = await api.get(`/statistics`);
        const servers = await api.get(`/servers`);

        if (statistics.status === 200) {
            setStatisticsData(statistics.data);
        }

        if (servers.status === 200) {
            setServersData(servers.data);
        }
    };

    const fetchDeviceStatistics = async () => {
        const response = await api.get(`/devices/statistics/summary`);
        if (response.status === 200) {
            setDeviceStatisticsData(response.data);
        }
    };

    const fetchData = async () => {
        setIsRefreshing(true);

        if (isEmpty(cookies.user)) {
            history("/main");
            return;
        }

        try {
            await Promise.all([fetchServerStatistics(), fetchDeviceStatistics()]);
            setIsLoaded(true);
        } catch (err) {
            if (err.response && err.response.status === 401) {
                handleLogout();
            } else {
                setError(err);
            }
        } finally {
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
    };

    const formatBytes = (bytes) => {
        const bytesNum = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;

        if (!bytesNum) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytesNum) / Math.log(k));
        return parseFloat((bytesNum / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const formatSpeed = (speed) => {
        if (speed === null || speed === undefined || isNaN(speed) || speed === 0) {
            return "-";
        }

        const speedNum = typeof speed === "string" ? parseFloat(speed) : speed;

        if (isNaN(speedNum) || speedNum < 1) {
            return "-";
        }

        const k = 1024;
        const sizes = ["Bytes/s", "KB/s", "MB/s", "GB/s", "TB/s"];
        const i = Math.floor(Math.log(speedNum) / Math.log(k));
        return parseFloat((speedNum / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const getServerDescription = (serverId) => {
        if (!serversData || serversData.length === 0) {
            return `Сервер #${serverId}`;
        }

        const server = serversData.find((s) => s.id === serverId);
        if (server) {
            return server.description || server.name || `Сервер #${serverId}`;
        }

        return `Сервер #${serverId}`;
    };

    const formatStatTimestamp = (timestamp) =>
        formatTimestamp(timestamp, { shortYear: true });

    const handleResetServerStatistics = async (serverId) => {
        try {
            await api.delete(`/statistics/${serverId}/reset`);

            const server = serversData.find(
                (s) => Number(s.id) === Number(serverId)
            );
            if (server) {
                await api.post(`/servers/${serverId}/restart`);
            }

            await fetchData();
        } catch (err) {
            if (err.response && err.response.status === 401) {
                handleLogout();
            } else {
                setError(err);
            }
        }
    };

    const handleResetDeviceStatistics = async (device) => {
        try {
            await api.delete(`/devices/${device.id}/statistics/reset`);
            await fetchData();
        } catch (err) {
            if (err.response && err.response.status === 401) {
                handleLogout();
            } else {
                setError(err);
            }
        }
    };

    return (
        <>
            {!isEmpty(cookies.user) ? (
                <div style={{ padding: "20px" }}>
                    <Box
                        sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            mb: 2,
                        }}
                    >
                        <Typography variant="h4" sx={{ m: 0 }}>
                            Статистика
                        </Typography>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<RefreshIcon />}
                            onClick={fetchData}
                            disabled={isRefreshing}
                            sx={{ mr: 1 }}
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

                    <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
                        <Tab label="Серверы" />
                        <Tab label="Устройства" />
                    </Tabs>

                    {tab === 0 && (
                        <>
                            {isLoaded && !isEmpty(statisticsData) ? (
                                <TableContainer component={Paper}>
                                    <Table sx={{ minWidth: 650 }} aria-label="server statistics table">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell><b>Описание сервера</b></TableCell>
                                                <TableCell><b>Байт получено</b></TableCell>
                                                <TableCell><b>Байт отправлено</b></TableCell>
                                                <TableCell><b>Скорость приема</b></TableCell>
                                                <TableCell><b>Скорость передачи</b></TableCell>
                                                <TableCell><b>Активные соединения</b></TableCell>
                                                <TableCell><b>Время обновления</b></TableCell>
                                                <TableCell><b>Действия</b></TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {statisticsData
                                                .sort((a, b) => b.timestamp - a.timestamp)
                                                .map((stat) => (
                                                    <TableRow
                                                        key={`${stat.server_id}-${stat.timestamp}`}
                                                        hover
                                                        onClick={() => {
                                                            setSelectedServer(stat.server_id);
                                                            setModalOpen(true);
                                                        }}
                                                        style={{ cursor: "pointer" }}
                                                    >
                                                        <TableCell>{getServerDescription(stat.server_id)}</TableCell>
                                                        <TableCell>{formatBytes(stat.bytes_received)}</TableCell>
                                                        <TableCell>{formatBytes(stat.bytes_sent)}</TableCell>
                                                        <TableCell>{formatSpeed(stat.avg_receive_speed)}</TableCell>
                                                        <TableCell>{formatSpeed(stat.avg_send_speed)}</TableCell>
                                                        <TableCell>{stat.connections_count}</TableCell>
                                                        <TableCell>{formatStatTimestamp(stat.timestamp)}</TableCell>
                                                        <TableCell>
                                                            <IconButton
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleResetServerStatistics(stat.server_id);
                                                                }}
                                                                color="secondary"
                                                            >
                                                                <DeleteIcon />
                                                            </IconButton>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            ) : (
                                <Loader title={"Статистика серверов не доступна"} />
                            )}
                        </>
                    )}

                    {tab === 1 && (
                        <>
                            {isLoaded && !isEmpty(deviceStatisticsData) ? (
                                <TableContainer component={Paper}>
                                    <Table sx={{ minWidth: 650 }} aria-label="device statistics table">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell><b>Устройство</b></TableCell>
                                                <TableCell><b>Статус</b></TableCell>
                                                <TableCell><b>Порт</b></TableCell>
                                                <TableCell><b>Байт получено</b></TableCell>
                                                <TableCell><b>Байт отправлено</b></TableCell>
                                                <TableCell><b>Скорость приема</b></TableCell>
                                                <TableCell><b>Скорость передачи</b></TableCell>
                                                <TableCell><b>За текущий час</b></TableCell>
                                                <TableCell><b>Соединения</b></TableCell>
                                                <TableCell><b>Последняя активность</b></TableCell>
                                                <TableCell><b>Действия</b></TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {deviceStatisticsData.map((device) => (
                                                <TableRow
                                                    key={device.id}
                                                    hover
                                                    onClick={() => {
                                                        setSelectedDevice(device);
                                                        setDeviceModalOpen(true);
                                                    }}
                                                    style={{ cursor: "pointer" }}
                                                >
                                                    <TableCell>
                                                        {device.name || device.device_id}
                                                        <Typography variant="caption" display="block" color="text.secondary">
                                                            {device.device_id}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Chip
                                                            label={device.online ? "online" : device.status || "offline"}
                                                            color={device.online ? "success" : "default"}
                                                            size="small"
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        {device.session_port || device.assigned_port || "-"}
                                                    </TableCell>
                                                    <TableCell>{formatBytes(device.bytes_received)}</TableCell>
                                                    <TableCell>{formatBytes(device.bytes_sent)}</TableCell>
                                                    <TableCell>{formatSpeed(device.avg_receive_speed)}</TableCell>
                                                    <TableCell>{formatSpeed(device.avg_send_speed)}</TableCell>
                                                    <TableCell>
                                                        {formatBytes(device.hourly_bytes_received)} / {formatBytes(device.hourly_bytes_sent)}
                                                    </TableCell>
                                                    <TableCell>{device.active_connections || 0}</TableCell>
                                                    <TableCell>{formatStatTimestamp(device.last_activity)}</TableCell>
                                                    <TableCell>
                                                        <IconButton
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleResetDeviceStatistics(device);
                                                            }}
                                                            color="secondary"
                                                        >
                                                            <DeleteIcon />
                                                        </IconButton>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            ) : (
                                <Loader title={"Статистика устройств не доступна"} />
                            )}
                        </>
                    )}
                </div>
            ) : (
                <></>
            )}
            <ServerStatsModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                serverId={selectedServer}
                serversData={serversData}
            />
            <DeviceStatsModal
                open={deviceModalOpen}
                onClose={() => setDeviceModalOpen(false)}
                device={selectedDevice}
                devicesData={deviceStatisticsData}
            />
        </>
    );
};

export default Statistics;
