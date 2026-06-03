import React, { useState, useEffect, useContext } from "react";
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
import Chip from "@mui/material/Chip";
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
    formatTimestamp,
    buildDeviceChartFromSamples,
    buildDeviceChartFromHistory,
    timeRangeToHours,
} from "../utils/statsFormat";

const BoxChip = ({ status, online }) => (
    <Chip
        label={online ? "online" : status || "offline"}
        color={online ? "success" : "default"}
        size="small"
        sx={{ mt: 0.5 }}
    />
);

const DeviceStatsModal = ({ open, onClose, device, devicesData }) => {
    const { api } = useContext(ApiContext);
    const [timeRange, setTimeRange] = useState("24hours");
    const [chartData, setChartData] = useState([]);
    const [statsPayload, setStatsPayload] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [visibleParams, setVisibleParams] = useState({
        bytesReceived: true,
        bytesSent: true,
        peakConnections: true,
        avgReceiveSpeed: true,
        avgSendSpeed: true,
    });

    const getDeviceTitle = () => {
        if (statsPayload?.device) {
            return statsPayload.device.name || statsPayload.device.device_id;
        }
        if (device) {
            return device.name || device.device_id;
        }
        return "Устройство";
    };

    useEffect(() => {
        let intervalId;

        if (open && device?.id) {
            fetchChartData();

            intervalId = setInterval(() => {
                fetchChartData();
            }, 30000);
        }

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, device?.id, timeRange]);

    const fetchChartData = async () => {
        if (!device?.id) {
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const hours = timeRangeToHours(timeRange);
            const response = await api.get(`/devices/${device.id}/statistics`, {
                params: { hours },
            });

            if (response.status !== 200) {
                setError(`Server returned status ${response.status}`);
                setChartData([]);
                return;
            }

            setStatsPayload(response.data);

            const samples = Array.isArray(response.data.samples) ? response.data.samples : [];
            const history = Array.isArray(response.data.history) ? response.data.history : [];

            if (samples.length > 0 || response.data.current_session) {
                setChartData(buildDeviceChartFromSamples(samples, timeRange));
            } else {
                setChartData(buildDeviceChartFromHistory(history, timeRange));
            }
        } catch (err) {
            const message =
                err.response?.data?.error ||
                err.response?.data?.details ||
                err.message ||
                "Не удалось загрузить статистику устройства";
            setError(message);
            console.error("Error fetching device chart data:", err);
            setChartData([]);
        } finally {
            setIsLoading(false);
        }
    };

    const summaryDevice =
        devicesData?.find((item) => item.id === device?.id) || device || statsPayload?.device;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>
                {getDeviceTitle()}
                {summaryDevice?.device_id && (
                    <Typography variant="caption" display="block" color="text.secondary">
                        {summaryDevice.device_id}
                    </Typography>
                )}
            </DialogTitle>
            <DialogContent dividers>
                <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={12} md={3}>
                        <Paper sx={{ p: 1.5 }}>
                            <Typography variant="caption" color="text.secondary">
                                Статус
                            </Typography>
                            <BoxChip status={summaryDevice?.status} online={summaryDevice?.online} />
                        </Paper>
                    </Grid>
                    <Grid item xs={12} md={3}>
                        <Paper sx={{ p: 1.5 }}>
                            <Typography variant="caption" color="text.secondary">
                                Текущая сессия
                            </Typography>
                            <Typography variant="body2">
                                ↓ {formatBytes(statsPayload?.current_session?.bytes_received || 0)}
                            </Typography>
                            <Typography variant="body2">
                                ↑ {formatBytes(statsPayload?.current_session?.bytes_sent || 0)}
                            </Typography>
                            <Typography variant="body2" sx={{ mt: 0.5 }}>
                                ↓ {formatSpeed(statsPayload?.summary?.avg_receive_speed)}
                            </Typography>
                            <Typography variant="body2">
                                ↑ {formatSpeed(statsPayload?.summary?.avg_send_speed)}
                            </Typography>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} md={3}>
                        <Paper sx={{ p: 1.5 }}>
                            <Typography variant="caption" color="text.secondary">
                                За период
                            </Typography>
                            <Typography variant="body2">
                                ↓ {formatBytes(statsPayload?.summary?.total_bytes_received || 0)}
                            </Typography>
                            <Typography variant="body2">
                                ↑ {formatBytes(statsPayload?.summary?.total_bytes_sent || 0)}
                            </Typography>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} md={3}>
                        <Paper sx={{ p: 1.5 }}>
                            <Typography variant="caption" color="text.secondary">
                                Пик соединений
                            </Typography>
                            <Typography variant="h6">
                                {statsPayload?.summary?.peak_connections ||
                                    statsPayload?.current_session?.active_connections ||
                                    0}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Порт: {statsPayload?.current_session?.assigned_port ||
                                    summaryDevice?.session_port ||
                                    "-"}
                            </Typography>
                        </Paper>
                    </Grid>
                </Grid>

                <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel id="device-time-range-label">Период времени</InputLabel>
                    <Select
                        labelId="device-time-range-label"
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

                <div
                    style={{
                        marginBottom: "16px",
                        padding: "12px",
                        backgroundColor: "#f5f5f5",
                        borderRadius: "4px",
                    }}
                >
                    <Typography variant="subtitle2" gutterBottom>
                        Отображаемые параметры:
                    </Typography>
                    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                        {[
                            ["bytesReceived", "Байт получено"],
                            ["bytesSent", "Байт отправлено"],
                            ["peakConnections", "Пик соединений"],
                            ["avgReceiveSpeed", "Скорость приема"],
                            ["avgSendSpeed", "Скорость передачи"],
                        ].map(([key, label]) => (
                            <div key={key} style={{ display: "flex", alignItems: "center" }}>
                                <input
                                    type="checkbox"
                                    id={`device-${key}`}
                                    checked={visibleParams[key]}
                                    onChange={() =>
                                        setVisibleParams((prev) => ({
                                            ...prev,
                                            [key]: !prev[key],
                                        }))
                                    }
                                    style={{ marginRight: "8px" }}
                                />
                                <label htmlFor={`device-${key}`} style={{ cursor: "pointer" }}>
                                    {label}
                                </label>
                            </div>
                        ))}
                    </div>
                </div>

                {isLoading ? (
                    <Loader title="Загрузка данных..." />
                ) : error ? (
                    <div style={{ color: "red", padding: "20px" }}>{error}</div>
                ) : (
                    <div style={{ width: "100%", height: 400, minHeight: 400 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                            <LineChart
                                data={chartData}
                                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="timestamp" angle={-45} textAnchor="end" height={80} />
                                <YAxis
                                    yAxisId="left"
                                    orientation="left"
                                    stroke="#8884d8"
                                    tickFormatter={(value) => formatBytes(value)}
                                />
                                <YAxis
                                    yAxisId="right"
                                    orientation="right"
                                    stroke="#82ca9d"
                                    tickFormatter={(value) => formatSpeed(value)}
                                />
                                <YAxis
                                    yAxisId="connections"
                                    orientation="right"
                                    stroke="#ff7300"
                                    domain={[0, "dataMax + 1"]}
                                />
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
                                                    <p
                                                        key={index}
                                                        style={{ margin: "5px 0", color: entry.stroke }}
                                                    >
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
                                {visibleParams.bytesReceived && (
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="bytesReceived"
                                        name="Байт получено"
                                        stroke="#8884d8"
                                        dot={false}
                                        strokeWidth={2}
                                    />
                                )}
                                {visibleParams.bytesSent && (
                                    <Line
                                        yAxisId="left"
                                        type="monotone"
                                        dataKey="bytesSent"
                                        name="Байт отправлено"
                                        stroke="#82ca9d"
                                        dot={false}
                                        strokeWidth={2}
                                    />
                                )}
                                {visibleParams.peakConnections && (
                                    <Line
                                        yAxisId="connections"
                                        type="monotone"
                                        dataKey="peakConnections"
                                        name="Пик соединений"
                                        stroke="#ff7300"
                                        dot={false}
                                        strokeWidth={2}
                                    />
                                )}
                                {visibleParams.avgReceiveSpeed && (
                                    <Line
                                        yAxisId="right"
                                        type="monotone"
                                        dataKey="avgReceiveSpeed"
                                        name="Скорость приема"
                                        stroke="#ff0000"
                                        dot={false}
                                        strokeWidth={2}
                                    />
                                )}
                                {visibleParams.avgSendSpeed && (
                                    <Line
                                        yAxisId="right"
                                        type="monotone"
                                        dataKey="avgSendSpeed"
                                        name="Скорость передачи"
                                        stroke="#00aa00"
                                        dot={false}
                                        strokeWidth={2}
                                    />
                                )}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
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

export default DeviceStatsModal;
