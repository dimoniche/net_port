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
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import IconButton from "@mui/material/IconButton";
import { Loader } from "../components/Loader";
import ServerStatsModal from "../components/ServerStatsModal";
import DeviceStatsModal from "../components/DeviceStatsModal";
import { useRealtimeSocket } from "../hooks/useRealtimeSocket";
import { formatTimestamp, parseDbTimestamp, formatBytes, formatPeriodDeltaPercent } from "../utils/statsFormat";
import DevicePortBadges from "../components/DevicePortBadges";
import FilterSelect from "../components/FilterSelect";
import {
    getEnabledLegacyServers,
    hasEnabledLegacyServers,
} from "../utils/legacyServers";
import { isAdminUser } from "../utils/userRoles";
import { DEVICE_TYPES } from "../consts/deviceTypes";
import { StyledTableCell, StyledTableRow } from "../theme/TableTheme";
import { filterRowSx, filterFieldSx } from "../theme/filterLayout";

const statisticsTableContainerSx = {
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
};

const statisticsTableSx = {
    width: "100%",
    minWidth: 1280,
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

const renderPeriodDelta = (today, yesterday) => {
    const delta = formatPeriodDeltaPercent(today, yesterday);
    if (delta === null) {
        return null;
    }

    const color = delta > 0 ? "success.main" : delta < 0 ? "error.main" : "text.secondary";
    const sign = delta > 0 ? "+" : "";

    return (
        <Typography variant="caption" color={color} display="block">
            {sign}{delta}% vs вчера
        </Typography>
    );
};

const PeriodTrafficCell = ({ device }) => (
    <Box sx={{ whiteSpace: "normal" }}>
        <Typography variant="caption" display="block" color="text.secondary">
            ↓ {formatBytes(device.today_bytes_received)} / {formatBytes(device.yesterday_bytes_received)}
        </Typography>
        {renderPeriodDelta(device.today_bytes_received, device.yesterday_bytes_received)}
        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
            ↑ {formatBytes(device.today_bytes_sent)} / {formatBytes(device.yesterday_bytes_sent)}
        </Typography>
        {renderPeriodDelta(device.today_bytes_sent, device.yesterday_bytes_sent)}
    </Box>
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

    const [deviceSearchFilter, setDeviceSearchFilter] = useState("");
    const [deviceStatusFilter, setDeviceStatusFilter] = useState("");
    const [deviceTypeFilter, setDeviceTypeFilter] = useState("");
    const [deviceOnlineFilter, setDeviceOnlineFilter] = useState("");
    const [devicePortFilter, setDevicePortFilter] = useState("");
    const [deviceUserFilter, setDeviceUserFilter] = useState("");
    const [usersList, setUsersList] = useState([]);
    const [serverSearchFilter, setServerSearchFilter] = useState("");
    const [serverPortFilter, setServerPortFilter] = useState("");

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

    const enabledLegacyServers = useMemo(
        () => getEnabledLegacyServers(serversData),
        [serversData]
    );
    const hasLegacyServers = enabledLegacyServers.length > 0;

    const realtimeHandlers = useMemo(
        () => ({
            'statistics:device-updated': mergeDeviceStatistics,
            'statistics:server-updated': mergeServerStatistics,
        }),
        [mergeServerStatistics, mergeDeviceStatistics]
    );

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

        const statistics = await api.get(`/statistics`, {
            params: cookies.user?.id ? { user_id: cookies.user.id } : undefined,
        });
        if (statistics.status === 200) {
            const enabledIds = new Set(
                getEnabledLegacyServers(serverList).map((server) => Number(server.id))
            );
            setStatisticsData(
                (statistics.data || []).filter((stat) =>
                    enabledIds.has(Number(stat.server_id))
                )
            );
        }
    };

    const fetchDeviceStatistics = useCallback(async () => {
        const params = {};
        if (isAdminUser(cookies.user) && deviceUserFilter) {
            params.user_id = deviceUserFilter;
        }

        const response = await api.get(`/devices/statistics/summary`, { params });
        if (response.status === 200) {
            setDeviceStatisticsData(response.data);
        }
    }, [api, cookies.user, deviceUserFilter]);

    const fetchData = async () => {
        setIsRefreshing(true);

        if (isEmpty(cookies.user)) {
            history("/main");
            return;
        }

        try {
            const admin = isAdminUser(cookies.user);
            let serverList = [];

            if (admin) {
                const serversResponse = await api.get(
                    `/servers/0?user_id=${cookies.user.id}`
                );
                serverList =
                    serversResponse.status === 200 ? serversResponse.data : [];
                setServersData(serverList);
            } else {
                setServersData([]);
            }

            await Promise.all([
                admin ? fetchServerStatistics(serverList) : Promise.resolve(),
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
        if (!isAdminUser(cookies.user)) {
            return;
        }

        api.get("/users", { params: { $limit: 100, $sort: { login: 1 } } })
            .then((response) => {
                const rows = Array.isArray(response.data?.data)
                    ? response.data.data
                    : Array.isArray(response.data)
                        ? response.data
                        : [];
                setUsersList(rows);
            })
            .catch(() => {});
    }, [api, cookies.user]);

    useEffect(() => {
        if (!isLoaded) {
            return;
        }
        fetchDeviceStatistics();
    }, [deviceUserFilter, fetchDeviceStatistics, isLoaded]);

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

    const getServerMeta = (serverId) => {
        if (!serversData || serversData.length === 0) {
            return null;
        }
        return serversData.find((s) => Number(s.id) === Number(serverId)) || null;
    };

    const getServerDescription = (serverId) => {
        const server = getServerMeta(serverId);
        if (server) {
            return server.description || server.name || `Сервер #${serverId}`;
        }
        return `Сервер #${serverId}`;
    };

    const filteredServerStatistics = useMemo(() => {
        const search = serverSearchFilter.trim().toLowerCase();
        const portQuery = serverPortFilter.trim();

        return statisticsData
            .filter((stat) => {
                const server = getServerMeta(stat.server_id);
                const description = getServerDescription(stat.server_id).toLowerCase();

                if (search && !description.includes(search)) {
                    const ports = server
                        ? `${server.input_port} ${server.output_port}`.toLowerCase()
                        : "";
                    if (!ports.includes(search) && !String(stat.server_id).includes(search)) {
                        return false;
                    }
                }

                if (portQuery && server) {
                    const matchesPort =
                        String(server.input_port).includes(portQuery) ||
                        String(server.output_port).includes(portQuery);
                    if (!matchesPort) {
                        return false;
                    }
                } else if (portQuery && !server) {
                    return false;
                }

                return true;
            })
            .slice()
            .sort(
                (a, b) =>
                    (parseDbTimestamp(b.timestamp)?.getTime() || 0) -
                    (parseDbTimestamp(a.timestamp)?.getTime() || 0)
            );
    }, [
        statisticsData,
        serversData,
        serverSearchFilter,
        serverPortFilter,
    ]);

    const filteredDeviceStatistics = useMemo(() => {
        const search = deviceSearchFilter.trim().toLowerCase();
        const portQuery = devicePortFilter.trim();

        return deviceStatisticsData.filter((device) => {
            if (search) {
                const haystack = `${device.device_id || ""} ${device.name || ""}`.toLowerCase();
                if (!haystack.includes(search)) {
                    return false;
                }
            }

            if (deviceStatusFilter && device.status !== deviceStatusFilter) {
                return false;
            }

            if (deviceTypeFilter && device.type !== deviceTypeFilter) {
                return false;
            }

            if (deviceOnlineFilter === "online" && !device.online) {
                return false;
            }
            if (deviceOnlineFilter === "offline" && device.online) {
                return false;
            }

            if (portQuery) {
                const ports = [
                    device.assigned_port,
                    device.preferred_port,
                    device.session_port,
                ]
                    .filter((value) => value != null && value !== "")
                    .map(String);
                if (!ports.some((port) => port.includes(portQuery))) {
                    return false;
                }
            }

            return true;
        });
    }, [
        deviceStatisticsData,
        deviceSearchFilter,
        deviceStatusFilter,
        deviceTypeFilter,
        deviceOnlineFilter,
        devicePortFilter,
    ]);

    const hasActiveServerFilters = Boolean(
        serverSearchFilter.trim() || serverPortFilter.trim()
    );
    const admin = isAdminUser(cookies.user);
    const hasActiveDeviceFilters = Boolean(
        deviceSearchFilter.trim() ||
            deviceStatusFilter ||
            deviceTypeFilter ||
            deviceOnlineFilter ||
            devicePortFilter.trim() ||
            (admin && deviceUserFilter)
    );

    const resetServerFilters = () => {
        setServerSearchFilter("");
        setServerPortFilter("");
    };

    const resetDeviceFilters = () => {
        setDeviceSearchFilter("");
        setDeviceStatusFilter("");
        setDeviceTypeFilter("");
        setDeviceOnlineFilter("");
        setDevicePortFilter("");
        setDeviceUserFilter("");
    };

    const formatStatTimestamp = (timestamp) =>
        formatTimestamp(timestamp, { shortYear: true });

    const renderServerFilters = () => (
        <Paper sx={{ p: 1.5, mb: 2, overflow: "visible" }}>
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 1,
                    flexWrap: "wrap",
                    gap: 1,
                }}
            >
                <Typography variant="subtitle1" sx={{ fontSize: "0.95rem" }}>
                    Фильтры
                </Typography>
                {hasActiveServerFilters && (
                    <Button size="small" onClick={resetServerFilters}>
                        Сбросить
                    </Button>
                )}
            </Box>
            <Box sx={filterRowSx}>
                <TextField
                    fullWidth
                    size="small"
                    label="Поиск"
                    placeholder="Описание, порт или ID"
                    value={serverSearchFilter}
                    onChange={(e) => setServerSearchFilter(e.target.value)}
                    sx={filterFieldSx}
                />
                <TextField
                    fullWidth
                    size="small"
                    label="Порт"
                    placeholder="input / output"
                    value={serverPortFilter}
                    onChange={(e) => setServerPortFilter(e.target.value)}
                    sx={filterFieldSx}
                />
            </Box>
            {hasActiveServerFilters && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                    Показано {filteredServerStatistics.length} из {statisticsData.length}
                </Typography>
            )}
        </Paper>
    );

    const renderDeviceFilters = () => (
        <Paper sx={{ p: 1.5, mb: 2, overflow: "visible" }}>
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 1,
                    flexWrap: "wrap",
                    gap: 1,
                }}
            >
                <Typography variant="subtitle1" sx={{ fontSize: "0.95rem" }}>
                    Фильтры
                </Typography>
                {hasActiveDeviceFilters && (
                    <Button size="small" onClick={resetDeviceFilters}>
                        Сбросить
                    </Button>
                )}
            </Box>
            <Box sx={filterRowSx}>
                <TextField
                    fullWidth
                    size="small"
                    label="Поиск"
                    placeholder="ID или название"
                    value={deviceSearchFilter}
                    onChange={(e) => setDeviceSearchFilter(e.target.value)}
                    sx={filterFieldSx}
                />
                <FilterSelect
                    label="Статус"
                    value={deviceStatusFilter}
                    onChange={(e) => setDeviceStatusFilter(e.target.value)}
                >
                    <MenuItem value="">Все</MenuItem>
                    <MenuItem value="active">Активен</MenuItem>
                    <MenuItem value="inactive">Неактивен</MenuItem>
                    <MenuItem value="connecting">Подключается</MenuItem>
                    <MenuItem value="error">Ошибка</MenuItem>
                    <MenuItem value="pending">Ожидает</MenuItem>
                    <MenuItem value="blocked">Заблокирован</MenuItem>
                </FilterSelect>
                <FilterSelect
                    label="Online"
                    value={deviceOnlineFilter}
                    onChange={(e) => setDeviceOnlineFilter(e.target.value)}
                >
                    <MenuItem value="">Все</MenuItem>
                    <MenuItem value="online">Online</MenuItem>
                    <MenuItem value="offline">Offline</MenuItem>
                </FilterSelect>
                <FilterSelect
                    label="Тип"
                    value={deviceTypeFilter}
                    onChange={(e) => setDeviceTypeFilter(e.target.value)}
                >
                    <MenuItem value="">Все</MenuItem>
                    {DEVICE_TYPES.map(({ value, label }) => (
                        <MenuItem key={value} value={value}>
                            {label}
                        </MenuItem>
                    ))}
                </FilterSelect>
                <TextField
                    fullWidth
                    size="small"
                    label="Порт"
                    placeholder="assigned / preferred / session"
                    value={devicePortFilter}
                    onChange={(e) => setDevicePortFilter(e.target.value)}
                    sx={filterFieldSx}
                />
                {admin && (
                    <FilterSelect
                        label="Пользователь"
                        value={deviceUserFilter}
                        onChange={(e) => setDeviceUserFilter(e.target.value)}
                    >
                        <MenuItem value="">Все</MenuItem>
                        {usersList.map((user) => (
                            <MenuItem key={user.id} value={String(user.id)}>
                                {user.login}
                            </MenuItem>
                        ))}
                    </FilterSelect>
                )}
            </Box>
            {hasActiveDeviceFilters && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                    Показано {filteredDeviceStatistics.length} из {deviceStatisticsData.length}
                </Typography>
            )}
        </Paper>
    );

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
                            {renderServerFilters()}
                            {isLoaded ? (
                                !isEmpty(statisticsData) ? (
                                !isEmpty(filteredServerStatistics) ? (
                                <StatisticsTableShell ariaLabel="server statistics table">
                                    <TableHead>
                                        <TableRow>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "18%" }}>Описание сервера</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "12%" }} align="right">Байт получено</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "12%" }} align="right">Байт отправлено</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "12%" }} align="right">Скорость приема</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "12%" }} align="right">Скорость передачи</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Соединения</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "16%" }}>Время обновления</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "8%" }} align="center">Действия</StyledTableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {filteredServerStatistics.map((stat) => (
                                                <StyledTableRow
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
                                                </StyledTableRow>
                                            ))}
                                    </TableBody>
                                </StatisticsTableShell>
                                ) : (
                                <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                                    Нет серверов по выбранным фильтрам
                                </Typography>
                                )
                                ) : (
                                <Loader title={"Ожидание первых данных статистики серверов"} />
                                )
                            ) : (
                                <Loader title={"Загрузка..."} />
                            )}
                        </>
                    )}

                    {(!hasLegacyServers || tab === 1) && (
                        <>
                            {renderDeviceFilters()}
                            {isLoaded && !isEmpty(deviceStatisticsData) ? (
                                !isEmpty(filteredDeviceStatistics) ? (
                                <StatisticsTableShell ariaLabel="device statistics table">
                                    <TableHead>
                                        <TableRow>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "13%" }}>Устройство</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "8%" }}>Статус</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "11%", whiteSpace: "normal" }} align="center">Порт</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Байт получено</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Байт отправлено</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Скорость приема</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "10%" }} align="right">Скорость передачи</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "9%" }} align="right">За текущий час</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "14%", whiteSpace: "normal" }} align="right">
                                                Сегодня / вчера
                                            </StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "6%" }} align="right">Соединения</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "14%" }}>Последняя активность</StyledTableCell>
                                            <StyledTableCell sx={{ ...statisticsHeadCellSx, width: "8%" }} align="center">Действия</StyledTableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {filteredDeviceStatistics.map((device) => (
                                            <StyledTableRow
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
                                                    align="center"
                                                    sx={{
                                                        ...statisticsBodyCellSx,
                                                        whiteSpace: "normal",
                                                        overflow: "visible",
                                                    }}
                                                >
                                                    <Box sx={{ display: "flex", justifyContent: "center" }}>
                                                        <DevicePortBadges device={device} emptyLabel="-" />
                                                    </Box>
                                                </TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="right">{formatBytes(device.bytes_received)}</TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="right">{formatBytes(device.bytes_sent)}</TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="right">{formatSpeed(device.avg_receive_speed)}</TableCell>
                                                <TableCell sx={statisticsBodyCellSx} align="right">{formatSpeed(device.avg_send_speed)}</TableCell>
                                                <TableCell sx={{ ...statisticsBodyCellSx, whiteSpace: "normal" }} align="right">
                                                    {formatBytes(device.hourly_bytes_received)} / {formatBytes(device.hourly_bytes_sent)}
                                                </TableCell>
                                                <TableCell
                                                    sx={{
                                                        ...statisticsBodyCellSx,
                                                        whiteSpace: "normal",
                                                        verticalAlign: "top",
                                                    }}
                                                    align="right"
                                                >
                                                    <PeriodTrafficCell device={device} />
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
                                            </StyledTableRow>
                                        ))}
                                    </TableBody>
                                </StatisticsTableShell>
                                ) : (
                                <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                                    Нет устройств по выбранным фильтрам
                                </Typography>
                                )
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
