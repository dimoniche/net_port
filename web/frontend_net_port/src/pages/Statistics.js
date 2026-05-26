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
import DevicePortBadges from "../components/DevicePortBadges";

const statisticsTableContainerSx = {
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
};

const statisticsTableSx = {
    width: "100%",
    minWidth: 1100,
    tableLayout: "fixed",
};

const statisticsHeadCellSx = {
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    px: { xs: 0.75, sm: 1.5 },
    py: 1.25,
    fontSize: { xs: "0.75rem", sm: "0.875rem" },
};

const statisticsBodyCellSx = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    px: { xs: 0.75, sm: 1.5 },
    py: 1,
    fontSize: { xs: "0.75rem", sm: "0.875rem" },
};

const StatisticsTableShell = ({ ariaLabel, children }) => (
    <TableContainer component={Paper} sx={statisticsTableContainerSx}>
        <Table sx={statisticsTableSx} size="small" aria-label={ariaLabel}>
            {children}
        </Table>
    </TableContainer>
);

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

    const hasLegacyServers = serversData.length > 0;

    const realtimeHandlers = useMemo(() => {
        const handlers = {
            'statistics:device-updated': mergeDeviceStatistics,
        };

        if (hasLegacyServers) {
            handlers['statistics:server-updated'] = mergeServerStatistics;
        }

        return handlers;
    }, [mergeServerStatistics, mergeDeviceStatistics, hasLegacyServers]);

    useRealtimeSocket({
        token: cookies.token,
        enabled: liveUpdatesEnabled && !isEmpty(cookies.user),
        handlers: realtimeHandlers,
    });

    const fetchServerStatistics = async (serverList) => {
        if (!serverList || serverList.length === 0) {
            setStatisticsData([]);
            return;
        }

        const statistics = await api.get(`/statistics`);
        if (statistics.status === 200) {
            setStatisticsData(statistics.data);
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
            const serversResponse = await api.get(`/servers`);
            const serverList = serversResponse.status === 200 ? serversResponse.data : [];

            if (serversResponse.status === 200) {
                setServersData(serverList);
            }

            await Promise.all([
                fetchServerStatistics(serverList),
                fetchDeviceStatistics(),
            ]);
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

    useEffect(() => {
        if (isLoaded && !hasLegacyServers) {
            setTab(1);
        }
    }, [isLoaded, hasLegacyServers]);

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
                <Box
                    sx={{
                        width: "100%",
                        maxWidth: "100%",
                        boxSizing: "border-box",
                        p: { xs: 1.5, sm: 2.5 },
                    }}
                >
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
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, ml: "auto" }}>
                            <Button
                                variant="contained"
                                color="primary"
                                startIcon={<RefreshIcon />}
                                onClick={fetchData}
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

                    {hasLegacyServers && (
                        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
                            <Tab label="Серверы" />
                            <Tab label="Устройства" />
                        </Tabs>
                    )}

                    {hasLegacyServers && tab === 0 && (
                        <>
                            {isLoaded && !isEmpty(statisticsData) ? (
                                <StatisticsTableShell ariaLabel="server statistics table">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "18%" }}>Описание сервера</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "12%" }} align="right">Байт получено</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "12%" }} align="right">Байт отправлено</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "12%" }} align="right">Скорость приема</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "12%" }} align="right">Скорость передачи</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Соединения</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "16%" }}>Время обновления</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "8%" }} align="center">Действия</TableCell>
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
                                                    <TableCell sx={statisticsBodyCellSx}>{getServerDescription(stat.server_id)}</TableCell>
                                                    <TableCell sx={statisticsBodyCellSx} align="right">{formatBytes(stat.bytes_received)}</TableCell>
                                                    <TableCell sx={statisticsBodyCellSx} align="right">{formatBytes(stat.bytes_sent)}</TableCell>
                                                    <TableCell sx={statisticsBodyCellSx} align="right">{formatSpeed(stat.avg_receive_speed)}</TableCell>
                                                    <TableCell sx={statisticsBodyCellSx} align="right">{formatSpeed(stat.avg_send_speed)}</TableCell>
                                                    <TableCell sx={statisticsBodyCellSx} align="right">{stat.connections_count}</TableCell>
                                                    <TableCell sx={statisticsBodyCellSx}>{formatStatTimestamp(stat.timestamp)}</TableCell>
                                                    <TableCell sx={statisticsBodyCellSx} align="center">
                                                        <IconButton
                                                            size="small"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleResetServerStatistics(stat.server_id);
                                                            }}
                                                            color="secondary"
                                                        >
                                                            <DeleteIcon fontSize="small" />
                                                        </IconButton>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                    </TableBody>
                                </StatisticsTableShell>
                            ) : (
                                <Loader title={"Статистика серверов не доступна"} />
                            )}
                        </>
                    )}

                    {(!hasLegacyServers || tab === 1) && (
                        <>
                            {isLoaded && !isEmpty(deviceStatisticsData) ? (
                                <StatisticsTableShell ariaLabel="device statistics table">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "13%" }}>Устройство</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "8%" }}>Статус</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "11%", whiteSpace: "normal" }}>Порт</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Байт получено</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Байт отправлено</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Скорость приема</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Скорость передачи</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">За текущий час</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "7%" }} align="right">Соединения</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "14%" }}>Последняя активность</TableCell>
                                            <TableCell sx={{ ...statisticsHeadCellSx, width: "8%" }} align="center">Действия</TableCell>
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
                                                <TableCell sx={{ ...statisticsBodyCellSx, whiteSpace: "normal" }}>
                                                    {device.name || device.device_id}
                                                    <Typography variant="caption" display="block" color="text.secondary" noWrap>
                                                        {device.device_id}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell sx={statisticsBodyCellSx}>
                                                    <Chip
                                                        label={device.online ? "online" : device.status || "offline"}
                                                        color={device.online ? "success" : "default"}
                                                        size="small"
                                                    />
                                                </TableCell>
                                                <TableCell
                                                    sx={{
                                                        ...statisticsBodyCellSx,
                                                        verticalAlign: "top",
                                                        whiteSpace: "normal",
                                                        overflow: "visible",
                                                    }}
                                                >
                                                    <DevicePortBadges device={device} emptyLabel="-" />
                                                </TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="right">{formatBytes(device.bytes_received)}</TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="right">{formatBytes(device.bytes_sent)}</TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="right">{formatSpeed(device.avg_receive_speed)}</TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="right">{formatSpeed(device.avg_send_speed)}</TableCell>
                                                <TableCell sx={{ ...statisticsBodyCellSx, whiteSpace: "normal" }} align="right">
                                                    {formatBytes(device.hourly_bytes_received)} / {formatBytes(device.hourly_bytes_sent)}
                                                </TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="right">{device.active_connections || 0}</TableCell>
                                                <TableCell sx={statisticsBodyCellSx}>{formatStatTimestamp(device.last_activity)}</TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="center">
                                                    <IconButton
                                                        size="small"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleResetDeviceStatistics(device);
                                                        }}
                                                        color="secondary"
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </StatisticsTableShell>
                            ) : (
                                <Loader title={"Статистика устройств не доступна"} />
                            )}
                        </>
                    )}
                </Box>
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
