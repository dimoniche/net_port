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
import { Loader } from "./Loader";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

// Функция для форматирования байтов в читаемый формат
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Функция для форматирования скорости в читаемый формат
const formatSpeed = (speed) => {
    // Проверяем на null, undefined, NaN или нулевое значение
    if (speed === null || speed === undefined || isNaN(speed) || speed === 0) {
        return '-';
    }
    
    // Преобразуем в число, если пришло строковое значение
    const speedNum = typeof speed === 'string' ? parseFloat(speed) : speed;
    
    // Проверяем еще раз после преобразования
    if (isNaN(speedNum) || speedNum < 1) {
        return '-';
    }
    
    const k = 1024;
    const sizes = ['Bytes/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
    const i = Math.floor(Math.log(speedNum) / Math.log(k));
    return parseFloat((speedNum / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const ServerStatsModal = ({ open, onClose, serverId, serversData }) => {
    const { api } = useContext(ApiContext);
    const [timeRange, setTimeRange] = useState("1day");
    const [chartData, setChartData] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [visibleParams, setVisibleParams] = useState({
        bytesReceived: true,
        bytesSent: true,
        connections: true,
        avgReceiveSpeed: true,
        avgSendSpeed: true
    });

    // Функция для получения описания сервера
    const getServerDescription = (serverId) => {
        if (!serversData || serversData.length === 0) {
            return `Сервер #${serverId}`;
        }

        let server = serversData.find(s => s.id === serverId);

        if (server) {
            return server.description || server.name || `Сервер #${serverId}`;
        } else {
            return `Сервер #${serverId}`;
        }
    };

    console.log('ServerStatsModal props:', { open, serverId, timeRange }); // Debug log

    // Автоматическое обновление данных каждые 15 секунд
    useEffect(() => {
        let intervalId;

        if (open && serverId !== null && serverId !== undefined) {
            // Первая загрузка данных
            console.log('Fetching chart data for server:', serverId); // Debug log
            fetchChartData();

            // Установка интервала для автоматического обновления
            intervalId = setInterval(() => {
                console.log('Auto-refreshing chart data...');
                fetchChartData();
            }, 60000); // 60 секунд
        }

        // Очистка интервала при закрытии модального окна
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
                console.log('Auto-refresh interval cleared');
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, serverId, timeRange]);

    const fetchChartData = async () => {
            setIsLoading(true);
            setError(null);
    
            try {
                // Calculate time range
                const endTime = new Date();
                const startTime = new Date();
    
                switch (timeRange) {
                    case "1hour":
                        startTime.setHours(endTime.getHours() - 1);
                        break;
                    case "6hours":
                        startTime.setHours(endTime.getHours() - 6);
                        break;
                    case "1day":
                        startTime.setDate(endTime.getDate() - 1);
                        break;
                    case "3days":
                        startTime.setDate(endTime.getDate() - 3);
                        break;
                    case "1week":
                        startTime.setDate(endTime.getDate() - 7);
                        break;
                    case "1month":
                        startTime.setMonth(endTime.getMonth() - 1);
                        break;
                    default:
                        startTime.setDate(endTime.getDate() - 1);
                }
    
                // Format dates to local time strings that preserve timezone info
                const formatLocalDateTime = (date) => {
                    const pad = (num) => String(num).padStart(2, '0');
                    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
                };
    
                console.log('API Request:', `/statistics/${serverId}/range`, {
                    startTime: formatLocalDateTime(startTime),
                    endTime: formatLocalDateTime(endTime)
                }); // Debug log
    
                const response = await api.get(`/statistics/${serverId}/range`, {
                    params: {
                        startTime: formatLocalDateTime(startTime),
                        endTime: formatLocalDateTime(endTime)
                    }
                });

            console.log('API Response Status:', response.status); // Debug log

            if (response.status === 200) {
                console.log('API Response:', response.data); // Debug log

                // Check if response.data is an array and has items
                if (Array.isArray(response.data) && response.data.length > 0) {
                    // Сначала форматируем базовые данные
                    const baseData = response.data.map((item) => {
                        // Create a date object from the timestamp
                        // Since the backend now returns data in local time, we treat it as such
                        let date;
                        if (typeof item.timestamp === 'string' && item.timestamp.includes('T')) {
                            // For ISO-like strings, parse manually to avoid timezone conversion
                            const parts = item.timestamp.split('T');
                            if (parts.length === 2) {
                                const datePart = parts[0];
                                const timePart = parts[1].split('.')[0].split(':');
                                const dateParts = datePart.split('-');
                                if (dateParts.length === 3 && timePart.length >= 2) {
                                    date = new Date(
                                        parseInt(dateParts[0]),
                                        parseInt(dateParts[1]) - 1, // Month is 0-indexed
                                        parseInt(dateParts[2]),
                                        parseInt(timePart[0]) || 0,
                                        parseInt(timePart[1]) || 0,
                                        parseInt(timePart[2]) || 0
                                    );
                                }
                            }
                        }
                        
                        // Fallback to regular Date parsing if manual parsing failed
                        if (!date || isNaN(date.getTime())) {
                            date = new Date(item.timestamp);
                        }
                        
                        // Use compact time format: HH:MM for short periods, DD.MM HH:MM for longer periods
                        const hours = String(date.getHours()).padStart(2, '0');
                        const minutes = String(date.getMinutes()).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        const month = String(date.getMonth() + 1).padStart(2, '0');
    
                        // For time ranges less than 1 day, show only time
                        // For longer ranges, show date and time
                        let timestampLabel;
                        if (timeRange === '1hour' || timeRange === '6hours') {
                            timestampLabel = `${hours}:${minutes}`;
                        } else {
                            timestampLabel = `${day}.${month} ${hours}:${minutes}`;
                        }
                        
                        return {
                            timestamp: timestampLabel,
                            fullTimestamp: date.toLocaleString(), // Keep full timestamp for tooltip
                            bytesReceived: item.bytes_received || 0,
                            bytesSent: item.bytes_sent || 0,
                            connections: item.connections_count || 0,
                            date: date // Сохраняем объект даты для вычислений
                        };
                    });
                    
                    // Затем вычисляем скорость на основе разницы между соседними точками
                    const formattedData = baseData.map((item, index) => {
                        let avgReceiveSpeed = 0;
                        let avgSendSpeed = 0;
                        
                        if (index > 0) {
                            const prevItem = baseData[index - 1];
                            const timeDiff = (item.date.getTime() - prevItem.date.getTime()) / 1000; // в секундах
                            
                            if (timeDiff > 0) {
                                avgReceiveSpeed = (item.bytesReceived - prevItem.bytesReceived) / timeDiff;
                                avgSendSpeed = (item.bytesSent - prevItem.bytesSent) / timeDiff;
                            }
                        }
                        
                        return {
                            ...item,
                            avgReceiveSpeed: avgReceiveSpeed,
                            avgSendSpeed: avgSendSpeed
                        };
                    });
                    
                    setChartData(formattedData);
                } else {
                    setError("No data available for the selected time range");
                    setChartData([]);
                }
            } else {
                setError(`Server returned status ${response.status}`);
            }
        } catch (err) {
            setError("Failed to load chart data");
            console.error("Error fetching chart data:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTimeRangeChange = (event) => {
        setTimeRange(event.target.value);
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            onError={(error) => {
                console.error('Dialog error:', error);
            }}
        >
            <DialogTitle>{getServerDescription(serverId)}</DialogTitle>
            <DialogContent dividers>
                {/* Always show time range selector */}
                <FormControl fullWidth sx={{ mb: 2, mt: 1 }}>
                    <InputLabel id="time-range-label">Период времени</InputLabel>
                    <Select
                        labelId="time-range-label"
                        value={timeRange}
                        label="Период времени"
                        onChange={handleTimeRangeChange}
                    >
                        <MenuItem value="1hour">Последний час</MenuItem>
                        <MenuItem value="6hours">Последние 6 часов</MenuItem>
                        <MenuItem value="1day">Последний день</MenuItem>
                        <MenuItem value="3days">Последние 3 дня</MenuItem>
                        <MenuItem value="1week">Последняя неделя</MenuItem>
                        <MenuItem value="1month">Последний месяц</MenuItem>
                    </Select>
                </FormControl>

                {/* Parameter visibility controls */}
                <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                    <Typography variant="subtitle2" gutterBottom style={{ marginBottom: '8px' }}>
                        Отображаемые параметры:
                    </Typography>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <input
                                type="checkbox"
                                id="bytesReceived"
                                checked={visibleParams.bytesReceived}
                                onChange={() => setVisibleParams(prev => ({ ...prev, bytesReceived: !prev.bytesReceived }))}
                                style={{ marginRight: '8px' }}
                            />
                            <label htmlFor="bytesReceived" style={{ cursor: 'pointer' }}>Байт получено</label>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <input
                                type="checkbox"
                                id="bytesSent"
                                checked={visibleParams.bytesSent}
                                onChange={() => setVisibleParams(prev => ({ ...prev, bytesSent: !prev.bytesSent }))}
                                style={{ marginRight: '8px' }}
                            />
                            <label htmlFor="bytesSent" style={{ cursor: 'pointer' }}>Байт отправлено</label>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <input
                                type="checkbox"
                                id="connections"
                                checked={visibleParams.connections}
                                onChange={() => setVisibleParams(prev => ({ ...prev, connections: !prev.connections }))}
                                style={{ marginRight: '8px' }}
                            />
                            <label htmlFor="connections" style={{ cursor: 'pointer' }}>Активные соединения</label>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <input
                                type="checkbox"
                                id="avgReceiveSpeed"
                                checked={visibleParams.avgReceiveSpeed}
                                onChange={() => setVisibleParams(prev => ({ ...prev, avgReceiveSpeed: !prev.avgReceiveSpeed }))}
                                style={{ marginRight: '8px' }}
                            />
                            <label htmlFor="avgReceiveSpeed" style={{ cursor: 'pointer' }}>Скорость приема</label>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <input
                                type="checkbox"
                                id="avgSendSpeed"
                                checked={visibleParams.avgSendSpeed}
                                onChange={() => setVisibleParams(prev => ({ ...prev, avgSendSpeed: !prev.avgSendSpeed }))}
                                style={{ marginRight: '8px' }}
                            />
                            <label htmlFor="avgSendSpeed" style={{ cursor: 'pointer' }}>Скорость передачи</label>
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <Loader title="Загрузка данных..." />
                ) : error ? (
                    <div style={{ color: "red", padding: "20px" }}>{error}</div>
                ) : chartData.length === 0 ? (
                    <div style={{ color: "#666", padding: "20px", textAlign: "center" }}>
                        Нет данных для отображения за выбранный период. Пожалуйста, попробуйте другой интервал времени.
                    </div>
                ) : (
                        <div style={{ width: '100%', height: 400, minHeight: 400 }}>
                            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                                <LineChart
                                    data={chartData}
                                    margin={{
                                        top: 20,
                                        right: 30,
                                        left: 20,
                                        bottom: 20,
                                    }}
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
                                    tickFormatter={(value) => value}
                                    domain={[0, 'dataMax + 1']}
                                />
                               <Tooltip
                                    content={({ payload, label }) => {
                                        if (!payload || payload.length === 0) return null;

                                        const item = payload[0].payload;
                                        return (
                                            <div style={{
                                                backgroundColor: 'white',
                                                border: '1px solid #ccc',
                                                padding: '10px',
                                                borderRadius: '4px'
                                            }}>
                                                <p style={{ margin: '5px 0', fontWeight: 'bold' }}>
                                                    {item.fullTimestamp || label}
                                                </p>
                                                {payload.map((entry, index) => (
                                                    <p key={index} style={{
                                                        margin: '5px 0',
                                                        color: entry.stroke
                                                    }}>
                                                        {entry.name}: {entry.dataKey.includes('bytes') ? formatBytes(entry.value) :
                                                                   entry.dataKey.includes('Speed') ? formatSpeed(entry.value) : entry.value}
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
                               {visibleParams.connections && (
                                   <Line
                                       yAxisId="connections"
                                       type="monotone"
                                       dataKey="connections"
                                       name="Активные соединения"
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
                                       stroke="#00ff00"
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

export default ServerStatsModal;