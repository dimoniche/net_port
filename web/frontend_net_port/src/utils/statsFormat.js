export const formatBytes = (bytes) => {
    const bytesNum = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
    if (!bytesNum) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytesNum) / Math.log(k));
    return parseFloat((bytesNum / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const parseSpeedNumber = (speed) => {
    if (speed === null || speed === undefined || speed === "") {
        return 0;
    }

    const speedNum = typeof speed === "string" ? parseFloat(speed) : Number(speed);
    return Number.isFinite(speedNum) && speedNum > 0 ? speedNum : 0;
};

export const formatPeriodDeltaPercent = (today, yesterday) => {
    const todayValue = Number(today) || 0;
    const yesterdayValue = Number(yesterday) || 0;

    if (yesterdayValue === 0) {
        if (todayValue === 0) {
            return null;
        }
        return 100;
    }

    return Math.round(((todayValue - yesterdayValue) / yesterdayValue) * 100);
};

export const formatSpeed = (speed) => {
    const speedNum = parseSpeedNumber(speed);

    if (speedNum === 0) {
        return "0 B/s";
    }

    if (speedNum < 1) {
        return `${speedNum.toFixed(2)} B/s`;
    }

    const k = 1024;
    const sizes = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
    const i = Math.min(
        sizes.length - 1,
        Math.max(0, Math.floor(Math.log(speedNum) / Math.log(k)))
    );
    return parseFloat((speedNum / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const parseDbTimestamp = (value) => {
    if (value == null || value === "") {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const text = String(value).trim();
    if (!text) {
        return null;
    }

    if (/[zZ]$/.test(text) || /[+-]\d{2}(:?\d{2})?$/.test(text)) {
        const date = new Date(text);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const normalized = text.includes("T") ? text : text.replace(" ", "T");
    const withoutMs = normalized.split(".")[0];
    const date = new Date(`${withoutMs}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
};

export const formatTimestamp = (timestamp, options = {}) => {
    const date = parseDbTimestamp(timestamp);
    if (!date) {
        return "-";
    }

    return date.toLocaleString("ru-RU", {
        year: options.shortYear ? "2-digit" : "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: options.withSeconds ? "2-digit" : undefined,
    });
};

export const formatChartAxisLabel = (timestamp, timeRange) => {
    const date = parseDbTimestamp(timestamp);
    if (!date) {
        return "-";
    }

    if (timeRange === "1hour" || timeRange === "6hours") {
        return date.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }

    return date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
};

export const timeRangeToHours = (timeRange) => {
    switch (timeRange) {
        case "1hour":
            return 1;
        case "6hours":
            return 6;
        case "24hours":
        case "1day":
            return 24;
        case "3days":
            return 72;
        case "1week":
            return 168;
        case "1month":
            return 24 * 30;
        default:
            return 24;
    }
};

export const normalizeChartTimeRange = (timeRange) => {
    if (timeRange === "1day") {
        return "24hours";
    }
    return timeRange;
};

export const getChartBucketMs = (timeRange) => {
    switch (timeRange) {
        case "1hour":
        case "6hours":
            return 60 * 1000;
        case "24hours":
        case "1day":
            return 5 * 60 * 1000;
        case "3days":
            return 15 * 60 * 1000;
        case "1week":
            return 60 * 60 * 1000;
        case "1month":
            return 4 * 60 * 60 * 1000;
        default:
            return 5 * 60 * 1000;
    }
};

export const getChartRangeBounds = (timeRange) => {
    const endTime = new Date();
    const startTime = new Date(endTime);

    switch (timeRange) {
        case "1hour":
            startTime.setHours(endTime.getHours() - 1);
            break;
        case "6hours":
            startTime.setHours(endTime.getHours() - 6);
            break;
        case "24hours":
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

    const bucketMs = getChartBucketMs(timeRange);
    const endMs = Math.floor(endTime.getTime() / bucketMs) * bucketMs;
    const startMs = Math.floor(startTime.getTime() / bucketMs) * bucketMs;

    return {
        startTime: new Date(startMs),
        endTime: new Date(endMs),
        bucketMs,
    };
};

export const getServerRangeTimes = (timeRange) => {
    const { startTime, endTime } = getChartRangeBounds(timeRange);
    return {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
    };
};

const chartAxisTimeRange = (timeRange) => normalizeChartTimeRange(timeRange);

const buildFilledTimeline = ({
    timeRange,
    bucketMs,
    bucketMap,
    createPoint,
}) => {
    const { startTime, endTime } = getChartRangeBounds(timeRange);
    const axisRange = chartAxisTimeRange(timeRange);
    const result = [];
    let state = createPoint.initialState();

    for (let t = startTime.getTime(); t <= endTime.getTime(); t += bucketMs) {
        const bucket = bucketMap.get(t);
        state = createPoint.nextState(state, bucket, t);
        const date = new Date(t);
        result.push({
            ...createPoint.toRow(state, bucket, t),
            timestamp: formatChartAxisLabel(date, axisRange),
            fullTimestamp: formatTimestamp(date),
            date,
        });
    }

    return result;
};

export const buildDeviceChartFromSamples = (samples, timeRange) => {
    const { bucketMs } = getChartRangeBounds(timeRange);
    const bucketMap = new Map();

    (samples || []).forEach((sample) => {
        const date = parseDbTimestamp(sample.recorded_at);
        if (!date) {
            return;
        }

        const key = Math.floor(date.getTime() / bucketMs) * bucketMs;
        const existing = bucketMap.get(key) || {
            receivedDelta: 0,
            sentDelta: 0,
            connections: 0,
        };
        existing.receivedDelta += Number(sample.bytes_received_delta || 0);
        existing.sentDelta += Number(sample.bytes_sent_delta || 0);
        existing.connections = Math.max(existing.connections, Number(sample.active_connections || 0));
        bucketMap.set(key, existing);
    });

    return buildFilledTimeline({
        timeRange,
        bucketMs,
        bucketMap,
        createPoint: {
            initialState: () => ({
                cumulativeReceived: 0,
                cumulativeSent: 0,
            }),
            nextState: (state, bucket) => {
                const receivedDelta = bucket?.receivedDelta || 0;
                const sentDelta = bucket?.sentDelta || 0;
                return {
                    cumulativeReceived: state.cumulativeReceived + receivedDelta,
                    cumulativeSent: state.cumulativeSent + sentDelta,
                    receivedDelta,
                    sentDelta,
                    connections: bucket?.connections || 0,
                };
            },
            toRow: (state) => {
                const dt = bucketMs / 1000;
                return {
                    bytesReceived: state.cumulativeReceived,
                    bytesSent: state.cumulativeSent,
                    peakConnections: state.connections,
                    avgReceiveSpeed: dt > 0 ? state.receivedDelta / dt : 0,
                    avgSendSpeed: dt > 0 ? state.sentDelta / dt : 0,
                };
            },
        },
    });
};

export const buildDeviceChartFromHistory = (history, timeRange) => {
    const hourMs = 60 * 60 * 1000;
    const { startTime, endTime } = getChartRangeBounds(timeRange);
    const startMs = Math.floor(startTime.getTime() / hourMs) * hourMs;
    const endMs = Math.floor(endTime.getTime() / hourMs) * hourMs;
    const axisRange = chartAxisTimeRange(timeRange);
    const bucketMap = new Map();

    (history || []).forEach((item) => {
        const date = parseDbTimestamp(item.period_start);
        if (!date) {
            return;
        }
        const key = Math.floor(date.getTime() / hourMs) * hourMs;
        bucketMap.set(key, item);
    });

    const result = [];
    let prevBytesReceived = 0;
    let prevBytesSent = 0;
    let prevTime = null;

    for (let t = startMs; t <= endMs; t += hourMs) {
        const item = bucketMap.get(t);
        const bytesReceived = item ? Number(item.bytes_received || 0) : 0;
        const bytesSent = item ? Number(item.bytes_sent || 0) : 0;
        const peakConnections = item ? Number(item.peak_connections || 0) : 0;

        let avgReceiveSpeed = 0;
        let avgSendSpeed = 0;
        if (prevTime !== null) {
            const dt = (t - prevTime) / 1000;
            if (dt > 0) {
                avgReceiveSpeed = (bytesReceived - prevBytesReceived) / dt;
                avgSendSpeed = (bytesSent - prevBytesSent) / dt;
            }
        }

        const date = new Date(t);
        result.push({
            timestamp: formatChartAxisLabel(date, axisRange),
            fullTimestamp: formatTimestamp(date),
            bytesReceived,
            bytesSent,
            peakConnections,
            avgReceiveSpeed,
            avgSendSpeed,
            date,
        });

        prevBytesReceived = bytesReceived;
        prevBytesSent = bytesSent;
        prevTime = t;
    }

    return result;
};

export const buildServerChartFromPoints = (points, timeRange) => {
    const { startTime, endTime, bucketMs } = getChartRangeBounds(timeRange);
    const axisRange = chartAxisTimeRange(timeRange);
    const bucketMap = new Map();

    (points || []).forEach((point) => {
        const date = parseDbTimestamp(point.timestamp);
        if (!date) {
            return;
        }

        const key = Math.floor(date.getTime() / bucketMs) * bucketMs;
        bucketMap.set(key, {
            bytesReceived: Number(point.bytes_received || 0),
            bytesSent: Number(point.bytes_sent || 0),
            connections: Number(point.connections_count || 0),
        });
    });

    const result = [];
    let bytesReceived = 0;
    let bytesSent = 0;
    let prevBytesReceived = 0;
    let prevBytesSent = 0;
    let prevTime = null;

    for (let t = startTime.getTime(); t <= endTime.getTime(); t += bucketMs) {
        const bucket = bucketMap.get(t);
        if (bucket) {
            bytesReceived = bucket.bytesReceived;
            bytesSent = bucket.bytesSent;
        }

        let avgReceiveSpeed = 0;
        let avgSendSpeed = 0;
        if (prevTime !== null) {
            const dt = (t - prevTime) / 1000;
            if (dt > 0) {
                avgReceiveSpeed = (bytesReceived - prevBytesReceived) / dt;
                avgSendSpeed = (bytesSent - prevBytesSent) / dt;
            }
        }

        const date = new Date(t);
        result.push({
            timestamp: formatChartAxisLabel(date, axisRange),
            fullTimestamp: formatTimestamp(date),
            bytesReceived,
            bytesSent,
            connections: bucket?.connections || 0,
            avgReceiveSpeed: Math.max(0, avgReceiveSpeed),
            avgSendSpeed: Math.max(0, avgSendSpeed),
            date,
        });

        prevBytesReceived = bytesReceived;
        prevBytesSent = bytesSent;
        prevTime = t;
    }

    return result;
};

export const mergeAggregatedChartData = ({ serverSeries, deviceSeries, timeRange }) => {
    const { bucketMs } = getChartRangeBounds(timeRange);
    const buckets = new Map();

    const addToBucket = (timestamp, { receivedDelta = 0, sentDelta = 0, connections = 0 }) => {
        if (!timestamp || Number.isNaN(timestamp.getTime())) {
            return;
        }

        const key = Math.floor(timestamp.getTime() / bucketMs) * bucketMs;
        const existing = buckets.get(key) || {
            receivedDelta: 0,
            sentDelta: 0,
            connections: 0,
        };
        existing.receivedDelta += receivedDelta;
        existing.sentDelta += sentDelta;
        existing.connections = Math.max(existing.connections, connections);
        buckets.set(key, existing);
    };

    deviceSeries.forEach(({ samples }) => {
        (samples || []).forEach((sample) => {
            addToBucket(parseDbTimestamp(sample.recorded_at), {
                receivedDelta: Number(sample.bytes_received_delta || 0),
                sentDelta: Number(sample.bytes_sent_delta || 0),
                connections: Number(sample.active_connections || 0),
            });
        });
    });

    serverSeries.forEach(({ points }) => {
        const sorted = [...(points || [])].sort(
            (a, b) =>
                parseDbTimestamp(a.timestamp).getTime() -
                parseDbTimestamp(b.timestamp).getTime()
        );

        sorted.forEach((point, index) => {
            const prev = index > 0 ? sorted[index - 1] : null;
            const receivedDelta = prev
                ? Number(point.bytes_received || 0) - Number(prev.bytes_received || 0)
                : Number(point.bytes_received || 0);
            const sentDelta = prev
                ? Number(point.bytes_sent || 0) - Number(prev.bytes_sent || 0)
                : Number(point.bytes_sent || 0);

            addToBucket(parseDbTimestamp(point.timestamp), {
                receivedDelta: Math.max(0, receivedDelta),
                sentDelta: Math.max(0, sentDelta),
                connections: Number(point.connections_count || 0),
            });
        });
    });

    return buildFilledTimeline({
        timeRange,
        bucketMs,
        bucketMap: buckets,
        createPoint: {
            initialState: () => ({
                cumulativeReceived: 0,
                cumulativeSent: 0,
            }),
            nextState: (state, bucket) => {
                const receivedDelta = bucket?.receivedDelta || 0;
                const sentDelta = bucket?.sentDelta || 0;
                return {
                    cumulativeReceived: state.cumulativeReceived + receivedDelta,
                    cumulativeSent: state.cumulativeSent + sentDelta,
                    receivedDelta,
                    sentDelta,
                    connections: bucket?.connections || 0,
                };
            },
            toRow: (state) => {
                const dt = bucketMs / 1000;
                return {
                    bytesReceived: state.cumulativeReceived,
                    bytesSent: state.cumulativeSent,
                    peakConnections: state.connections,
                    avgReceiveSpeed: dt > 0 ? state.receivedDelta / dt : 0,
                    avgSendSpeed: dt > 0 ? state.sentDelta / dt : 0,
                };
            },
        },
    });
};
