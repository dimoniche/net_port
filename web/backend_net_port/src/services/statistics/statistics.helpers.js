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

function computeSpeed(currentRow, previousRow) {
  if (!previousRow) {
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

module.exports = {
  isLegacyPlaceholderServer,
  isEnabledLegacyServer,
  resolveStatisticsUserId,
  computeSpeed
};
