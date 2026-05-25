import React, { useState, useEffect, useContext, useMemo } from "react";
import { ApiContext } from "../context/ApiContext";

import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import InputLabel from "@mui/material/InputLabel";
import Typography from "@mui/material/Typography";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import { Loader } from "./Loader";

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";

import {
    formatBytes,
    formatSpeed,
    getServerRangeTimes,
    mergeAggregatedChartData,
    timeRangeToHours,
} from "../utils/statsFormat";

const TAB_MAP = {
    overview: 0,
    traffic: 1,
    connections: 2,
};

const OverviewStatsModal = ({
    open,
    onClose,
    focus = "overview",
    headerSummary,
    statisticsData,
    deviceStatisticsData,
    serversData,
}) => {
    const { api } = useContext(ApiContext);
    const [timeRange, setTimeRange] = useState("24hours");
    const [tab, setTab] = useState(TAB_MAP[focus] ?? 0);
    const [chartData, setChartData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setTab(TAB_MAP[focus] ?? 0);
        }
    }, [open, focus]);

    const breakdown = useMemo(() => {
        const servers = (statisticsData || []).map((stat) => {
            const server = (serversData || []).find(
                (item) => Number(item.id) === Number(stat.server_id)
            );
            return {
                key: `server-${stat.server_id}`,
                label: server?.description || server?.name || `Сервер #${stat.server_id}`,
                bytesReceived: Number(stat.bytes_received || 0),
                bytesSent: Number(stat.bytes_sent || 0),
                connections: Number(stat.connections_count || 0),
                type: "server",
            };
        });

        const devices = (deviceStatisticsData || []).map((device) => ({
            key: `device-${device.id}`,
            label: device.name || device.device_id,
            bytesReceived: Number(device.bytes_received || 0),
            bytesSent: Number(device.bytes_sent || 0),
            connections: Number(device.active_connections || 0),
            online: Boolean(device.online),
            type: "device",
        }));

        return [...servers, ...devices];
    }, [statisticsData, deviceStatisticsData, serversData]);

    const fetchChartData = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const serverIds = [
                ...new Set((statisticsData || []).map((stat) => stat.server_id).filter(Boolean)),
            ];
            const devices = deviceStatisticsData || [];
            const { startTime, endTime } = getServerRangeTimes(timeRange);
            const hours = timeRangeToHours(timeRange);

            const serverResponses = await Promise.all(
                serverIds.map((serverId) =>
                    api
                        .get(`/statistics/${serverId}/range`, {
                            params: { startTime, endTime },
                        })
                        .then((response) => ({
                            serverId,
                            points: response.status === 200 ? response.data : [],
                        }))
                        .catch(() => ({ serverId, points: [] }))
                )
            );

            const deviceResponses = await Promise.all(
                devices.map((device) =>
                    api
                        .get(`/devices/${device.id}/statistics`, {
                            params: { hours },
                        })
                        .then((response) => ({
                            deviceId: device.id,
                            samples:
                                response.status === 200 && Array.isArray(response.data?.samples)
                                    ? response.data.samples
                                    : [],
                        }))
                        .catch(() => ({ deviceId: device.id, samples: [] }))
                )
            );

            const merged = mergeAggregatedChartData({
                serverSeries: serverResponses,
                deviceSeries: deviceResponses,
                timeRange,
            });

            if (merged.length === 0) {
                setChartData([]);
                setError("Нет данных за выбранный период");
            } else {
                setChartData(merged);
                setError(null);
            }
        } catch (err) {
            console.error("Error fetching overview chart data:", err);
            setError("Не удалось загрузить данные для графика");
            setChartData([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        let intervalId;

        if (open) {
            fetchChartData();
            intervalId = setInterval(fetchChartData, 30000);
        }

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, timeRange, statisticsData, deviceStatisticsData]);

    const renderChart = (lines) => (
        <Box sx={{ width: "100%", height: 360, minHeight: 360 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" angle={-45} textAnchor="end" height={80} />
                    {lines.some((line) => line.yAxisId === "left") && (
                        <YAxis
                            yAxisId="left"
                            orientation="left"
                            tickFormatter={(value) => formatBytes(value)}
                        />
                    )}
                    {lines.some((line) => line.yAxisId === "right") && (
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            tickFormatter={(value) => formatSpeed(value)}
                        />
                    )}
                    {lines.some((line) => line.yAxisId === "connections") && (
                        <YAxis yAxisId="connections" orientation="right" domain={[0, "dataMax + 1"]} />
                    )}
                    <Tooltip
                        content={({ payload }) => {
                            if (!payload || payload.length === 0) return null;
                            const item = payload[0].payload;
                            return (
                                <div
                                    style={{
                                        backgroundColor: "white",
                                        border: "1px solid #ccc",
                                        padding: "10px",
                                        borderRadius: "4px",
                                    }}
                                >
                                    <p style={{ margin: "5px 0", fontWeight: "bold" }}>
                                        {item.fullTimestamp}
                                    </p>
                                    {payload.map((entry, index) => (
                                        <p key={index} style={{ margin: "5px 0", color: entry.stroke }}>
                                            {entry.name}:{" "}
                                            {entry.dataKey.includes("bytes")
                                                ? formatBytes(entry.value)
                                                : entry.dataKey.includes("Speed")
                                                ? formatSpeed(entry.value)
                                                : entry.value}
                                        </p>
                                    ))}
                                </div>
                            );
                        }}
                    />
                    <Legend />
                    {lines.map((line) => (
                        <Line
                            key={line.dataKey}
                            yAxisId={line.yAxisId}
                            type="monotone"
                            dataKey={line.dataKey}
                            name={line.name}
                            stroke={line.stroke}
                            dot={false}
                            strokeWidth={2}
                        />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </Box>
    );

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>Общая статистика системы</DialogTitle>
            <DialogContent dividers>
                <Grid container spacing={1.5} sx={{ mb: 2 }}>
                    {[
                        ["Серверов", headerSummary.activeServers],
                        ["Устройств", `${headerSummary.totalDevices}${headerSummary.onlineDevices ? ` (${headerSummary.onlineDevices} online)` : ""}`],
                        ["Соединений", headerSummary.activeConnections],
                        ["Получено", formatBytes(headerSummary.totalBytes.received)],
                        ["Отправлено", formatBytes(headerSummary.totalBytes.sent)],
                        ["Прием", formatSpeed(headerSummary.totalSpeed.receive)],
                        ["Передача", formatSpeed(headerSummary.totalSpeed.send)],
                    ].map(([label, value]) => (
                        <Grid item xs={12} sm={6} md={4} lg={3} key={label}>
                            <Paper variant="outlined" sx={{ p: 1.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                    {label}
                                </Typography>
                                <Typography variant="body1">{value}</Typography>
                            </Paper>
                        </Grid>
                    ))}
                </Grid>

                <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel id="overview-time-range-label">Период времени</InputLabel>
                    <Select
                        labelId="overview-time-range-label"
                        value={timeRange}
                        label="Период времени"
                        onChange={(event) => setTimeRange(event.target.value)}
                    >
                        <MenuItem value="1hour">Последний час</MenuItem>
                        <MenuItem value="6hours">Последние 6 часов</MenuItem>
                        <MenuItem value="24hours">Последние 24 часа</MenuItem>
                        <MenuItem value="3days">Последние 3 дня</MenuItem>
                        <MenuItem value="1week">Последняя неделя</MenuItem>
                    </Select>
                </FormControl>

                <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
                    <Tab label="Обзор" />
                    <Tab label="Трафик" />
                    <Tab label="Соединения" />
                </Tabs>

                {isLoading ? (
                    <Loader title="Загрузка данных..." />
                ) : error && chartData.length === 0 ? (
                    <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                        {error}
                    </Typography>
                ) : tab === 0 ? (
                    <>
                        <Typography variant="subtitle1" gutterBottom>
                            Распределение по источникам
                        </Typography>
                        <Grid container spacing={1}>
                            {breakdown.length === 0 ? (
                                <Grid item xs={12}>
                                    <Typography color="text.secondary">Нет данных по источникам</Typography>
                                </Grid>
                            ) : (
                                breakdown.map((item) => (
                                    <Grid item xs={12} md={6} key={item.key}>
                                        <Paper variant="outlined" sx={{ p: 1.5 }}>
                                            <Typography variant="subtitle2">{item.label}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {item.type === "device"
                                                    ? item.online
                                                        ? "online"
                                                        : "offline"
                                                    : "сервер"}
                                            </Typography>
                                            <Typography variant="body2">
                                                Получено: {formatBytes(item.bytesReceived)}
                                            </Typography>
                                            <Typography variant="body2">
                                                Отправлено: {formatBytes(item.bytesSent)}
                                            </Typography>
                                            <Typography variant="body2">
                                                Соединений: {item.connections}
                                            </Typography>
                                        </Paper>
                                    </Grid>
                                ))
                            )}
                        </Grid>
                        {chartData.length > 0 && (
                            <>
                                <Typography variant="subtitle1" sx={{ mt: 3, mb: 1 }}>
                                    Суммарный трафик
                                </Typography>
                                {renderChart([
                                    { dataKey: "bytesReceived", name: "Байт получено", stroke: "#8884d8", yAxisId: "left" },
                                    { dataKey: "bytesSent", name: "Байт отправлено", stroke: "#82ca9d", yAxisId: "left" },
                                ])}
                            </>
                        )}
                    </>
                ) : tab === 1 ? (
                    renderChart([
                        { dataKey: "bytesReceived", name: "Байт получено", stroke: "#8884d8", yAxisId: "left" },
                        { dataKey: "bytesSent", name: "Байт отправлено", stroke: "#82ca9d", yAxisId: "left" },
                        { dataKey: "avgReceiveSpeed", name: "Скорость приема", stroke: "#ff0000", yAxisId: "right" },
                        { dataKey: "avgSendSpeed", name: "Скорость передачи", stroke: "#00aa00", yAxisId: "right" },
                    ])
                ) : (
                    renderChart([
                        {
                            dataKey: "peakConnections",
                            name: "Активные соединения",
                            stroke: "#ff7300",
                            yAxisId: "connections",
                        },
                    ])
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} color="primary">
                    Закрыть
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default OverviewStatsModal;
