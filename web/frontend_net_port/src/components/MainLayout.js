import React, { useState, useEffect, useContext, useCallback } from "react";
import { useTheme } from "@mui/material/styles";
import { useCookies } from "react-cookie";
import { useNavigate, useLocation } from "react-router-dom";
import { ApiContext } from "../context/ApiContext";

import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import CssBaseline from "@mui/material/CssBaseline";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import NavBlock from "./NavBlock";
import Tooltip from "@mui/material/Tooltip";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import LoginIcon from "@mui/icons-material/Login";
import Modal from "@mui/material/Modal";
import HelpCenterIcon from "@mui/icons-material/HelpCenter";

import { mainNavSection, minorNavSection } from "../routes";
import { AppBar, DrawerHeader, Main, drawerWidth } from "./MainLayout.styles";
import Login from "../pages/Login";

import { Can } from "./Abilities";
import updateAbility from "../config/permission";
import { useRealtimeSocket } from "../hooks/useRealtimeSocket";
import OverviewStatsModal from "./OverviewStatsModal";
import { formatBytes, formatSpeed, parseSpeedNumber } from "../utils/statsFormat";
import { getEnabledLegacyServers } from "../utils/legacyServers";

import logo from "../assets/netport-120-120.png";

const computeHeaderSummary = (statistics, devices, servers) => {
    const enabledLegacyServers = getEnabledLegacyServers(servers);
    const hasLegacyServers = enabledLegacyServers.length > 0;
    const enabledServerIds = new Set(
        enabledLegacyServers.map((server) => Number(server.id))
    );
    const activeServers = enabledLegacyServers.length;
    const deviceList = devices || [];
    const onlineDevices = deviceList.filter((device) => device.online).length;
    const activeConnections = deviceList.reduce(
        (sum, device) => sum + (Number(device.active_connections) || 0),
        0
    );

    const relevantStatistics = (statistics || []).filter((stat) =>
        enabledServerIds.has(Number(stat.server_id))
    );

    const serverReceived = relevantStatistics.reduce(
        (sum, stat) => sum + (parseInt(stat.bytes_received, 10) || 0),
        0
    );
    const serverSent = relevantStatistics.reduce(
        (sum, stat) => sum + (parseInt(stat.bytes_sent, 10) || 0),
        0
    );
    const deviceReceived = deviceList.reduce(
        (sum, device) => sum + (Number(device.bytes_received) || 0),
        0
    );
    const deviceSent = deviceList.reduce(
        (sum, device) => sum + (Number(device.bytes_sent) || 0),
        0
    );

    const serverReceiveSpeed = relevantStatistics.reduce(
        (sum, stat) => sum + parseSpeedNumber(stat.avg_receive_speed),
        0
    );
    const serverSendSpeed = relevantStatistics.reduce(
        (sum, stat) => sum + parseSpeedNumber(stat.avg_send_speed),
        0
    );
    const deviceReceiveSpeed = deviceList.reduce(
        (sum, device) => sum + parseSpeedNumber(device.avg_receive_speed),
        0
    );
    const deviceSendSpeed = deviceList.reduce(
        (sum, device) => sum + parseSpeedNumber(device.avg_send_speed),
        0
    );

    return {
        hasLegacyServers,
        activeServers,
        totalDevices: deviceList.length,
        onlineDevices,
        activeConnections,
        totalBytes: {
            received: serverReceived + deviceReceived,
            sent: serverSent + deviceSent,
        },
        totalSpeed: {
            receive: serverReceiveSpeed + deviceReceiveSpeed,
            send: serverSendSpeed + deviceSendSpeed,
        },
    };
};

const mergeServerStatistics = (current, updatedStat) => {
    if (!updatedStat?.server_id) {
        return current;
    }

    const index = current.findIndex(
        (item) => Number(item.server_id) === Number(updatedStat.server_id)
    );

    if (index === -1) {
        return [...current, updatedStat];
    }

    const next = [...current];
    next[index] = { ...next[index], ...updatedStat };
    return next;
};

const mergeDeviceStatistics = (current, updatedDevice) => {
    if (!updatedDevice?.id) {
        return current;
    }

    const index = current.findIndex((item) => item.id === updatedDevice.id);

    if (index === -1) {
        return [...current, updatedDevice];
    }

    const next = [...current];
    next[index] = { ...next[index], ...updatedDevice };
    return next;
};

const style = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: 600,
    bgcolor: "background.paper",
    border: "2px solid #000",
    boxShadow: 24,
    p: 6,
};

export default function PersistentDrawerLeft({ children, ...rest }) {
    const theme = useTheme();
    const [cookies, , removeCookie] = useCookies();
    const history = useNavigate();
    const location = useLocation();
    const { api } = useContext(ApiContext);

    const [open, setOpen] = React.useState(true);
    const handleDrawerOpen = () => setOpen(true);
    const handleDrawerClose = () => setOpen(false);

    const [openRight, setOpenRight] = React.useState(false);
    const handleDrawerOpenRight = () => setOpenRight(true);
    const handleDrawerCloseRight = () => setOpenRight(false);

    const [openLogin, setOpenLogin] = React.useState(false);

    // Statistics state
    const [statisticsData, setStatisticsData] = useState([]);
    const [deviceStatisticsData, setDeviceStatisticsData] = useState([]);
    const [serversData, setServersData] = useState([]);
    const [headerSummary, setHeaderSummary] = useState({
        hasLegacyServers: false,
        activeServers: 0,
        totalDevices: 0,
        onlineDevices: 0,
        activeConnections: 0,
        totalBytes: { received: 0, sent: 0 },
        totalSpeed: { receive: 0, send: 0 },
    });
    const [overviewModalOpen, setOverviewModalOpen] = useState(false);
    const [overviewFocus, setOverviewFocus] = useState("overview");

    const handleLogout = () => {
        removeCookie("token");
        removeCookie("user");

        api.delete(`/authentication`).catch((err) => {});

        history("/main");
        updateAbility(rest.ability, null);
    };

    const handleLogin = () => {
        setOpenLogin(true);
    };

    const handleCloseLogin = () => {
        setOpenLogin(false);
    };

    const openOverviewModal = (focus) => {
        setOverviewFocus(focus);
        setOverviewModalOpen(true);
    };

    const statChipSx = {
        cursor: "pointer",
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        "&:hover": {
            backgroundColor: "rgba(255, 255, 255, 0.12)",
        },
    };

    const handleServerStatisticsUpdate = useCallback((updatedStat) => {
        setStatisticsData((prev) => mergeServerStatistics(prev, updatedStat));
    }, []);

    const handleDeviceStatisticsUpdate = useCallback((updatedDevice) => {
        setDeviceStatisticsData((prev) => mergeDeviceStatistics(prev, updatedDevice));
    }, []);

    useRealtimeSocket({
        token: cookies.token,
        enabled: Boolean(cookies.user),
        handlers: {
            "statistics:server-updated": handleServerStatisticsUpdate,
            "statistics:device-updated": handleDeviceStatisticsUpdate,
        },
    });

    useEffect(() => {
        setHeaderSummary(
            computeHeaderSummary(statisticsData, deviceStatisticsData, serversData)
        );
    }, [statisticsData, deviceStatisticsData, serversData]);

    // Fetch statistics and servers data
    const fetchStatisticsData = useCallback(async () => {
        if (!cookies.user) return;

        try {
            const [statistics, servers, deviceStatistics] = await Promise.all([
                api.get(`/statistics`, {
                    params: cookies.user?.id ? { user_id: cookies.user.id } : undefined,
                }),
                api.get(`/servers/0?user_id=${cookies.user.id}`),
                api.get(`/devices/statistics/summary`),
            ]);

            if (statistics.status === 200) {
                setStatisticsData(statistics.data);
            }

            if (servers.status === 200) {
                setServersData(servers.data);
            }

            if (deviceStatistics.status === 200) {
                setDeviceStatisticsData(deviceStatistics.data);
            }
        } catch (err) {
            console.error("Error fetching statistics data:", err);
        }
    }, [api, cookies.user]);

    useEffect(() => {
      if (rest.ability !== undefined) {
        updateAbility(rest.ability, cookies.user);
      }
    }, [cookies.user, rest.ability]);

    // Fetch statistics data periodically
    useEffect(() => {
        if (cookies.user) {
            fetchStatisticsData();
            const interval = setInterval(fetchStatisticsData, 30000); // Update every 30 seconds
            return () => clearInterval(interval);
        }
    }, [cookies.user, fetchStatisticsData]);

    return (
        <React.Fragment>
            <Box sx={{ display: "flex" }}>
                <CssBaseline />
                <Box sc={{ flexGrow: 1 }}>
                    <AppBar position="fixed" open={open} openRight={openRight}>
                        <Toolbar sx={{ gap: 1, overflow: "hidden" }}>
                            <IconButton
                                color="inherit"
                                aria-label="open drawer"
                                onClick={handleDrawerOpen}
                                edge="start"
                                sx={{ ...(open && { display: "none" }) }}
                            >
                                <MenuIcon />
                            </IconButton>
                            <Typography
                                variant="h6"
                                noWrap
                                component="div"
                                sx={{ flexShrink: 0, mr: 1 }}
                            >
                                NET PORT
                            </Typography>
                            
                            {/* Statistics Info */}
                            <Box
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    flex: 1,
                                    minWidth: 0,
                                    justifyContent: "flex-end",
                                    flexWrap: "nowrap",
                                    gap: 0.75,
                                    overflowX: cookies.user ? "auto" : "hidden",
                                    overflowY: "hidden",
                                    py: 0.25,
                                    "&::-webkit-scrollbar": { height: 4 },
                                }}
                            >
                                {cookies.user && (
                                    <>
                                    {headerSummary.hasLegacyServers && (
                                        <Typography
                                            variant="body2"
                                            sx={{ ...statChipSx, flexShrink: 0, whiteSpace: "nowrap" }}
                                            onClick={() => openOverviewModal("overview")}
                                            title="Показать общую статистику"
                                        >
                                            Серверов: {headerSummary.activeServers}
                                        </Typography>
                                    )}
                                    <Typography
                                        variant="body2"
                                        sx={{ ...statChipSx, flexShrink: 0, whiteSpace: "nowrap" }}
                                        onClick={() => openOverviewModal("connections")}
                                        title="Показать график устройств и соединений"
                                    >
                                        Устройств: {headerSummary.totalDevices}
                                        {headerSummary.onlineDevices > 0
                                            ? ` (online: ${headerSummary.onlineDevices})`
                                            : ""}
                                    </Typography>
                                    {headerSummary.activeConnections > 0 && (
                                        <Typography
                                            variant="body2"
                                            sx={{ ...statChipSx, flexShrink: 0, whiteSpace: "nowrap" }}
                                            onClick={() => openOverviewModal("connections")}
                                            title="Показать график соединений"
                                        >
                                            Соединений: {headerSummary.activeConnections}
                                        </Typography>
                                    )}
                                    <Typography
                                        variant="body2"
                                        sx={{ ...statChipSx, flexShrink: 0, whiteSpace: "nowrap" }}
                                        onClick={() => openOverviewModal("traffic")}
                                        title="Показать график скорости"
                                    >
                                        Скорость: ↓{formatSpeed(headerSummary.totalSpeed.receive)} ↑
                                        {formatSpeed(headerSummary.totalSpeed.send)}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{ ...statChipSx, flexShrink: 0, whiteSpace: "nowrap" }}
                                        onClick={() => openOverviewModal("traffic")}
                                        title="Показать график трафика"
                                    >
                                        Получено: {formatBytes(headerSummary.totalBytes.received)}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{ ...statChipSx, flexShrink: 0, whiteSpace: "nowrap" }}
                                        onClick={() => openOverviewModal("traffic")}
                                        title="Показать график трафика"
                                    >
                                        Отправлено: {formatBytes(headerSummary.totalBytes.sent)}
                                    </Typography>
                                    </>
                                )}
                            </Box>

                            <Box
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    flexShrink: 0,
                                    gap: 0.5,
                                    ml: 1,
                                }}
                            >
                            {cookies.user && (
                                <Tooltip title="Текущий пользователь">
                                    <Typography sx={{ whiteSpace: "nowrap" }}>
                                        {cookies.user.login}
                                    </Typography>
                                </Tooltip>
                            )}
                            {location.pathname !== "/main" ? (
                                <Tooltip title="Помощь">
                                    <IconButton
                                        color="inherit"
                                        aria-label="open drawer"
                                        onClick={handleDrawerOpenRight}
                                        edge="end"
                                        sx={{
                                            ...(openRight && {
                                                display: "none",
                                            }),
                                        }}
                                    >
                                        <HelpCenterIcon />
                                    </IconButton>
                                </Tooltip>
                            ) : null}
                            {cookies.user ? (
                                <Tooltip title="Выход">
                                    <IconButton
                                        color="inherit"
                                        onClick={handleLogout}
                                        edge="end"
                                    >
                                        <ExitToAppIcon />
                                    </IconButton>
                                </Tooltip>
                            ) : (
                                <Tooltip title="Вход">
                                    <IconButton
                                        color="inherit"
                                        onClick={handleLogin}
                                        edge="end"
                                    >
                                        <LoginIcon />
                                    </IconButton>
                                </Tooltip>
                            )}
                            </Box>
                        </Toolbar>
                    </AppBar>
                </Box>
                <Drawer
                    sx={{
                        width: drawerWidth,
                        flexShrink: 0,
                        "& .MuiDrawer-paper": {
                            width: drawerWidth,
                            boxSizing: "border-box",
                        },
                    }}
                    variant="persistent"
                    anchor="left"
                    open={open}
                >
                    <DrawerHeader>
                        {false ? (
                            <img
                                src={logo}
                                alt="net port"
                                style={{ height: "48px" }}
                            />
                        ) : (
                            <></>
                        )}
                        <IconButton onClick={handleDrawerClose}>
                            {theme.direction === "ltr" ? (
                                <ChevronLeftIcon />
                            ) : (
                                <ChevronRightIcon />
                            )}
                        </IconButton>
                    </DrawerHeader>
                    <Divider />
                    <NavBlock navData={mainNavSection} ability={rest.ability} />
                    <Can I="read" a="Config" passThrough>
                        {(allowed) =>
                            allowed ? (
                                <>
                                    <Divider />
                                    <NavBlock navData={minorNavSection} />
                                </>
                            ) : (
                                <></>
                            )
                        }
                    </Can>
                    <Divider />
                </Drawer>
                {location.pathname !== "/main" ? (
                    <Drawer
                        sx={{
                            flexShrink: 0,
                            "& .MuiDrawer-paper": {
                                width: drawerWidth,
                                boxSizing: "border-box",
                            },
                        }}
                        variant="persistent"
                        anchor="right"
                        open={openRight}
                    >
                        <Divider />
                        <DrawerHeader>
                            <IconButton onClick={handleDrawerCloseRight}>
                                {theme.direction === "rtl" ? (
                                    <ChevronLeftIcon />
                                ) : (
                                    <ChevronRightIcon />
                                )}
                            </IconButton>
                        </DrawerHeader>
                        <Divider />
                        {location.pathname === "/main" ? (
                            <></>
                        ) : location.pathname === "/settings" ? (
                            <>
                                <b>Настройки пользователя.</b>
                                <br />
                                Настраиваются параметры доступа к сервису,
                                <br />
                                логин и пароль.
                            </>
                        ) : location.pathname.startsWith("/users") ? (
                            <>
                                <b>Управление пользователями</b>
                                <br />
                                Доступно только администратору.
                                <br />
                                Кнопка <b>«Добавить»</b> открывает форму создания
                                учётной записи с логином, паролем и ролью.
                            </>
                        ) : location.pathname === "/servers" ? (
                            <>
                                <b>Настройки серверов</b>
                                <br />
                                Возможно добавить новый сервер доступа с помощью
                                кнопки <b>"Добавить"</b>.
                                <br />
                                Кнопкой <b>"Перезагрузить"</b> осуществляется
                                перезапуск всех запущенных и пользователя
                                сервисов доступа к удаленным устройствам.
                                <br />
                                <br />
                                Настройки каждого сервера включают в себя
                                возможность выключить ожидание подключения
                                пользователей и устройств. <b>Входящий порт</b>
                                это порт подключения пользователя из вне к
                                сервису.
                                <b>Перенаправляемый порт</b> это порт к которому
                                подключается установленный на внешнем устройстве
                                клиент для поддержания постоянного соединения.
                            </>
                        ) : (
                            <></>
                        )}
                    </Drawer>
                ) : (
                    <></>
                )}
                <Main open={open} openRight={openRight}>
                    <DrawerHeader />
                    {children}
                    <DrawerHeader />
                </Main>
            </Box>
            <Modal
                aria-labelledby="unstyled-modal-title"
                aria-describedby="unstyled-modal-description"
                align-items="center"
                justify-content="center"
                open={openLogin}
                onClose={handleCloseLogin}
            >
                <Box sx={style}>
                    <Login ability={rest.ability} />
                </Box>
            </Modal>
            <OverviewStatsModal
                open={overviewModalOpen}
                onClose={() => setOverviewModalOpen(false)}
                focus={overviewFocus}
                headerSummary={headerSummary}
                statisticsData={statisticsData}
                deviceStatisticsData={deviceStatisticsData}
                serversData={serversData}
            />
        </React.Fragment>
    );
}
