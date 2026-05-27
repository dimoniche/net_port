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
            return 24;
        case "3days":
            return 72;
        case "1week":
            return 168;
        default:
            return 24;
    }
};

export const getServerRangeTimes = (timeRange) => {
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
            startTime.setDate(endTime.getDate() - 1);
            break;
        case "3days":
            startTime.setDate(endTime.getDate() - 3);
            break;
        case "1week":
            startTime.setDate(endTime.getDate() - 7);
            break;
        default:
            startTime.setDate(endTime.getDate() - 1);
    }

    return {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
    };
};

const bucketKey = (date, timeRange) => {
    const ms = date.getTime();
    const bucketMs = timeRange === "1hour" || timeRange === "6hours" ? 60000 : 300000;
    return Math.floor(ms / bucketMs) * bucketMs;
};

const formatBucketLabel = (date, timeRange) => formatChartAxisLabel(date, timeRange);

export const mergeAggregatedChartData = ({ serverSeries, deviceSeries, timeRange }) => {
    const buckets = new Map();

    const addToBucket = (timestamp, { receivedDelta = 0, sentDelta = 0, connections = 0 }) => {
        if (!timestamp || Number.isNaN(timestamp.getTime())) {
            return;
        }

        const key = bucketKey(timestamp, timeRange);
        const existing = buckets.get(key) || {
            time: key,
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

    const sortedBuckets = Array.from(buckets.values()).sort((a, b) => a.time - b.time);
    let cumulativeReceived = 0;
    let cumulativeSent = 0;

    return sortedBuckets.map((bucket, index) => {
        cumulativeReceived += bucket.receivedDelta;
        cumulativeSent += bucket.sentDelta;

        let avgReceiveSpeed = 0;
        let avgSendSpeed = 0;
        if (index > 0) {
            const prev = sortedBuckets[index - 1];
            const dt = (bucket.time - prev.time) / 1000;
            if (dt > 0) {
                avgReceiveSpeed = bucket.receivedDelta / dt;
                avgSendSpeed = bucket.sentDelta / dt;
            }
        }

        const date = new Date(bucket.time);
        return {
            timestamp: formatBucketLabel(date, timeRange),
            fullTimestamp: formatTimestamp(date),
            bytesReceived: cumulativeReceived,
            bytesSent: cumulativeSent,
            peakConnections: bucket.connections,
            avgReceiveSpeed,
            avgSendSpeed,
            date,
        };
    });
};
