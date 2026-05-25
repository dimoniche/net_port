export const formatBytes = (bytes) => {
    const bytesNum = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
    if (!bytesNum) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytesNum) / Math.log(k));
    return parseFloat((bytesNum / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const formatSpeed = (speed) => {
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

export const formatTimestamp = (timestamp) => {
    if (!timestamp) return "-";
    const date = new Date(timestamp);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}.${month} ${hours}:${minutes}`;
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

    const formatLocalDateTime = (date) => {
        const pad = (num) => String(num).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    };

    return {
        startTime: formatLocalDateTime(startTime),
        endTime: formatLocalDateTime(endTime),
    };
};

const bucketKey = (date, timeRange) => {
    const ms = date.getTime();
    const bucketMs = timeRange === "1hour" || timeRange === "6hours" ? 60000 : 300000;
    return Math.floor(ms / bucketMs) * bucketMs;
};

const formatBucketLabel = (date, timeRange) => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");

    if (timeRange === "1hour" || timeRange === "6hours") {
        return `${hours}:${minutes}:${seconds}`;
    }
    return `${day}.${month} ${hours}:${minutes}`;
};

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
            addToBucket(new Date(sample.recorded_at), {
                receivedDelta: Number(sample.bytes_received_delta || 0),
                sentDelta: Number(sample.bytes_sent_delta || 0),
                connections: Number(sample.active_connections || 0),
            });
        });
    });

    serverSeries.forEach(({ points }) => {
        const sorted = [...(points || [])].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        sorted.forEach((point, index) => {
            const prev = index > 0 ? sorted[index - 1] : null;
            const receivedDelta = prev
                ? Number(point.bytes_received || 0) - Number(prev.bytes_received || 0)
                : Number(point.bytes_received || 0);
            const sentDelta = prev
                ? Number(point.bytes_sent || 0) - Number(prev.bytes_sent || 0)
                : Number(point.bytes_sent || 0);

            addToBucket(new Date(point.timestamp), {
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
