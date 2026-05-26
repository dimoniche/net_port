'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const express = require('@feathersjs/express');

const METRICS_CACHE_MS = Number(process.env.METRICS_CACHE_MS || 5000);

let cachedMetrics = '';
let cachedMetricsAt = 0;

function resolveDocsPath() {
  const candidates = [
    path.join(__dirname, '../../../docs'),
    path.join(__dirname, '../../../../docs'),
    '/root/net_port/source/docs'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'openapi.yaml'))) {
      return candidate;
    }
  }

  return null;
}

async function checkTcpPort(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.end();
      resolve(true);
    });

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

async function collectPrometheusMetrics(knex) {
  const now = Date.now();
  if (cachedMetrics && now - cachedMetricsAt < METRICS_CACHE_MS) {
    return cachedMetrics;
  }

  const [
    devicesTotal,
    devicesActive,
    devicesConnecting,
    devicesOnline,
    portsAllocated,
    portsReserved,
    portsFree,
    sessionsActive,
    traffic
  ] = await Promise.all([
    knex('devices').count('* as count').first(),
    knex('devices').where('status', 'active').count('* as count').first(),
    knex('devices').where('status', 'connecting').count('* as count').first(),
    knex('devices')
      .where('last_heartbeat', '>', knex.raw("NOW() - interval '2 minutes'"))
      .count('* as count')
      .first(),
    knex('port_allocations').where('status', 'allocated').count('* as count').first(),
    knex('port_allocations').where('status', 'reserved').count('* as count').first(),
    knex('port_allocations')
      .where('status', 'free')
      .where('port', '>=', 6000)
      .where('port', '<=', 6999)
      .whereRaw('port % 2 = 0')
      .count('* as count')
      .first(),
    knex('device_sessions')
      .where('status', 'active')
      .where('expires_at', '>', knex.fn.now())
      .count('* as count')
      .first(),
    knex('device_sessions')
      .where('status', 'active')
      .where('expires_at', '>', knex.fn.now())
      .sum({
        bytes_sent: knex.raw('COALESCE(bytes_sent, 0)'),
        bytes_received: knex.raw('COALESCE(bytes_received, 0)'),
        active_connections: knex.raw('COALESCE(active_connections, 0)')
      })
      .first()
  ]);

  const lines = [
    '# HELP net_port_up Net Port backend is running.',
    '# TYPE net_port_up gauge',
    'net_port_up 1',
    '',
    '# HELP net_port_devices_total Total registered devices.',
    '# TYPE net_port_devices_total gauge',
    `net_port_devices_total ${Number(devicesTotal?.count || 0)}`,
    '',
    '# HELP net_port_devices_active Devices in active status.',
    '# TYPE net_port_devices_active gauge',
    `net_port_devices_active ${Number(devicesActive?.count || 0)}`,
    '',
    '# HELP net_port_devices_connecting Devices waiting for client registration.',
    '# TYPE net_port_devices_connecting gauge',
    `net_port_devices_connecting ${Number(devicesConnecting?.count || 0)}`,
    '',
    '# HELP net_port_devices_online Devices with heartbeat in last 2 minutes.',
    '# TYPE net_port_devices_online gauge',
    `net_port_devices_online ${Number(devicesOnline?.count || 0)}`,
    '',
    '# HELP net_port_ports_allocated Allocated external port pairs.',
    '# TYPE net_port_ports_allocated gauge',
    `net_port_ports_allocated ${Number(portsAllocated?.count || 0)}`,
    '',
    '# HELP net_port_ports_reserved Reserved fixed port pairs.',
    '# TYPE net_port_ports_reserved gauge',
    `net_port_ports_reserved ${Number(portsReserved?.count || 0)}`,
    '',
    '# HELP net_port_ports_available Free even ports in device range.',
    '# TYPE net_port_ports_available gauge',
    `net_port_ports_available ${Number(portsFree?.count || 0)}`,
    '',
    '# HELP net_port_sessions_active Active device sessions.',
    '# TYPE net_port_sessions_active gauge',
    `net_port_sessions_active ${Number(sessionsActive?.count || 0)}`,
    '',
    '# HELP net_port_session_connections Active tunneled connections.',
    '# TYPE net_port_session_connections gauge',
    `net_port_session_connections ${Number(traffic?.active_connections || 0)}`,
    '',
    '# HELP net_port_bytes_sent_total Bytes sent by active sessions.',
    '# TYPE net_port_bytes_sent_total counter',
    `net_port_bytes_sent_total ${Number(traffic?.bytes_sent || 0)}`,
    '',
    '# HELP net_port_bytes_received_total Bytes received by active sessions.',
    '# TYPE net_port_bytes_received_total counter',
    `net_port_bytes_received_total ${Number(traffic?.bytes_received || 0)}`,
    ''
  ];

  cachedMetrics = `${lines.join('\n')}\n`;
  cachedMetricsAt = now;
  return cachedMetrics;
}

async function collectHealthStatus(knex) {
  let database = false;
  let deviceControl = false;

  try {
    await knex.raw('SELECT 1');
    database = true;
  } catch (error) {
    database = false;
  }

  const controlHost = process.env.DEVICE_CONTROL_HOST || '127.0.0.1';
  const controlPort = Number(process.env.DEVICE_CONTROL_PORT || 8443);
  deviceControl = await checkTcpPort(controlHost, controlPort);

  const status = database && deviceControl ? 'ok' : 'degraded';

  return {
    status,
    checks: {
      database,
      device_control: deviceControl
    },
    timestamp: new Date().toISOString()
  };
}

function configureObservability(app) {
  const docsPath = resolveDocsPath();

  if (docsPath) {
    app.use('/docs', express.static(docsPath, { index: false }));
    app.get('/docs/openapi.yaml', (_req, res) => {
      res.type('application/yaml');
      res.sendFile(path.join(docsPath, 'openapi.yaml'));
    });
  }

  app.get('/health', async (_req, res) => {
    try {
      const knex = app.get('db');
      const payload = await collectHealthStatus(knex);
      res.status(payload.status === 'ok' ? 200 : 503).json(payload);
    } catch (error) {
      res.status(503).json({
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  app.get('/metrics', async (_req, res) => {
    try {
      const knex = app.get('db');
      const body = await collectPrometheusMetrics(knex);
      res.type('text/plain; version=0.0.4; charset=utf-8');
      res.send(body);
    } catch (error) {
      res.status(500).type('text/plain').send(`# metrics collection failed: ${error.message}\n`);
    }
  });
}

module.exports = {
  configureObservability,
  collectPrometheusMetrics,
  collectHealthStatus
};
