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

const formatTimestamp = (timestamp) => {
    if (!timestamp) return "-";
    const date = new Date(timestamp);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}.${month} ${hours}:${minutes}`;
};

const timeRangeToHours = (timeRange) => {
    switch (timeRange) {
        case "1hour":
            return 1;
        case "6hours":
            return 6;
        case "24hours":
            return 24;
        case "3days":
            return 72;
        case "1week":
            return 168;
        default:
            return 24;
    }
};

const buildChartFromSamples = (samples, timeRange) => {
    let cumulativeSent = 0;
    let cumulativeReceived = 0;

    return samples.map((sample, index) => {
        cumulativeSent += Number(sample.bytes_sent_delta || 0);
        cumulativeReceived += Number(sample.bytes_received_delta || 0);

        const date = new Date(sample.recorded_at);
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const seconds = String(date.getSeconds()).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");

        const timestampLabel =
            timeRange === "1hour" || timeRange === "6hours"
                ? `${hours}:${minutes}:${seconds}`
                : `${day}.${month} ${hours}:${minutes}`;

        let avgSendSpeed = 0;
        let avgReceiveSpeed = 0;
        if (index > 0) {
            const prev = samples[index - 1];
            const dt =
                (date.getTime() - new Date(prev.recorded_at).getTime()) / 1000;
            if (dt > 0) {
                avgSendSpeed = Number(sample.bytes_sent_delta || 0) / dt;
                avgReceiveSpeed = Number(sample.bytes_received_delta || 0) / dt;
            }
        }

        return {
            timestamp: timestampLabel,
            fullTimestamp: formatTimestamp(sample.recorded_at),
            bytesReceived: cumulativeReceived,
            bytesSent: cumulativeSent,
            peakConnections: Number(sample.active_connections || 0),
            avgSendSpeed,
            avgReceiveSpeed,
            date,
        };
    });
};

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
            if (samples.length > 0) {
                setChartData(buildChartFromSamples(samples, timeRange));
                return;
            }

            const history = Array.isArray(response.data.history) ? response.data.history : [];
            if (history.length === 0 && !response.data.current_session) {
                setError("Нет данных за выбранный период");
                setChartData([]);
                return;
            }

            const baseData = history.map((item) => {
                const date = new Date(item.period_start);
                const hoursLabel = String(date.getHours()).padStart(2, "0");
                const minutesLabel = String(date.getMinutes()).padStart(2, "0");
                const dayLabel = String(date.getDate()).padStart(2, "0");
                const monthLabel = String(date.getMonth() + 1).padStart(2, "0");

                const timestampLabel =
                    timeRange === "6hours" || timeRange === "24hours"
                        ? `${hoursLabel}:${minutesLabel}`
                        : `${dayLabel}.${monthLabel} ${hoursLabel}:${minutesLabel}`;

                return {
                    timestamp: timestampLabel,
                    fullTimestamp: formatTimestamp(item.period_start),
                    bytesReceived: item.bytes_received || 0,
                    bytesSent: item.bytes_sent || 0,
                    peakConnections: item.peak_connections || 0,
                    date,
                };
            });

            const formattedData = baseData.map((item, index) => {
                let avgReceiveSpeed = item.bytesReceived / 3600;
                let avgSendSpeed = item.bytesSent / 3600;

                if (index > 0) {
                    const prevItem = baseData[index - 1];
                    const timeDiff =
                        (item.date.getTime() - prevItem.date.getTime()) / 1000;
                    if (timeDiff > 0) {
                        avgReceiveSpeed =
                            (item.bytesReceived - prevItem.bytesReceived) / timeDiff;
                        avgSendSpeed = (item.bytesSent - prevItem.bytesSent) / timeDiff;
                    }
                }

                return {
                    ...item,
                    avgReceiveSpeed,
                    avgSendSpeed,
                };
            });

            setChartData(formattedData);
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
                ) : chartData.length === 0 ? (
                    <div style={{ color: "#666", padding: "20px", textAlign: "center" }}>
                        Нет данных за выбранный период.
                    </div>
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
