'use strict';

function isLegacyPlaceholderServer(server) {
  if (!server) {
    return true;
  }

  const inputPort = Number(server.input_port);
  const outputPort = Number(server.output_port);

  if (inputPort === 5998 && outputPort === 5999) {
    return true;
  }

  const description = String(server.description || '').toLowerCase();
  return description.includes('legacy placeholder');
}

function isEnabledLegacyServer(server) {
  return Boolean(server && server.enable === true && !isLegacyPlaceholderServer(server));
}

function resolveStatisticsUserId(params = {}) {
  if (params.query?.user_id != null) {
    return Number(params.query.user_id);
  }

  if (params.user?.id != null) {
    return Number(params.user.id);
  }

  return null;
}

function isMonotonicStatisticPredecessor(previousRow, currentRow) {
  if (!previousRow || !currentRow) {
    return false;
  }

  return Number(previousRow.bytes_received) <= Number(currentRow.bytes_received)
    && Number(previousRow.bytes_sent) <= Number(currentRow.bytes_sent);
}

function computeSpeed(currentRow, previousRow) {
  if (!previousRow || isEmptyStatisticRow(currentRow) || !isMonotonicStatisticPredecessor(previousRow, currentRow)) {
    return { avg_receive_speed: null, avg_send_speed: null };
  }

  const currentTs = new Date(currentRow.timestamp).getTime();
  const previousTs = new Date(previousRow.timestamp).getTime();
  const timeDiff = (currentTs - previousTs) / 1000;

  if (!Number.isFinite(timeDiff) || timeDiff <= 0) {
    return { avg_receive_speed: null, avg_send_speed: null };
  }

  const receiveDelta = Number(currentRow.bytes_received || 0) - Number(previousRow.bytes_received || 0);
  const sendDelta = Number(currentRow.bytes_sent || 0) - Number(previousRow.bytes_sent || 0);

  return {
    avg_receive_speed: receiveDelta > 0 ? receiveDelta / timeDiff : 0,
    avg_send_speed: sendDelta > 0 ? sendDelta / timeDiff : 0
  };
}

function isEmptyStatisticRow(row) {
  if (!row) {
    return true;
  }

  return Number(row.bytes_received || 0) === 0
    && Number(row.bytes_sent || 0) === 0
    && Number(row.connections_count || 0) === 0;
}

function filterRegressiveStatisticSnapshots(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return rows;
  }

  let maxReceived = 0;
  let maxSent = 0;

  return rows.filter((row) => {
    const received = Number(row.bytes_received || 0);
    const sent = Number(row.bytes_sent || 0);

    if (received + sent === 0) {
      return true;
    }

    if (received + 1024 < maxReceived && sent + 1024 < maxSent) {
      return false;
    }

    maxReceived = Math.max(maxReceived, received);
    maxSent = Math.max(maxSent, sent);
    return true;
  });
}

function filterEmptyStatisticSnapshots(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return rows;
  }

  return rows.filter((row, index, all) => {
    if (!isEmptyStatisticRow(row)) {
      return true;
    }

    const ts = new Date(row.timestamp).getTime();
    if (!Number.isFinite(ts)) {
      return true;
    }

    const hasNearbyData = all.some((other, otherIndex) => {
      if (otherIndex === index || isEmptyStatisticRow(other)) {
        return false;
      }

      const otherTs = new Date(other.timestamp).getTime();
      return Number.isFinite(otherTs) && Math.abs(otherTs - ts) <= 5000;
    });

    return !hasNearbyData;
  });
}

module.exports = {
  isLegacyPlaceholderServer,
  isEnabledLegacyServer,
  resolveStatisticsUserId,
  isMonotonicStatisticPredecessor,
  computeSpeed,
  isEmptyStatisticRow,
  filterEmptyStatisticSnapshots,
  filterRegressiveStatisticSnapshots
};
