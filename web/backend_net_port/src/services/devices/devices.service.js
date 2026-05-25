// Device management service for net_port system
const { Service } = require('feathers-knex');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const net = require('net');
const {
  enrichDeviceWithOnline,
  broadcastDeviceById
} = require('./device-events');

function isAdminUser(user) {
  return user?.role === 'admin' || user?.role_name === 'admin';
}

function sendDeviceControlCommand(deviceId, action) {
  const host = process.env.DEVICE_CONTROL_HOST || '127.0.0.1';
  const port = Number(process.env.DEVICE_CONTROL_PORT || 8443);
  const payload = JSON.stringify({ action, device_id: deviceId });

  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host, port }, () => {
      client.write(payload);
    });

    let responseData = '';

    client.on('data', (chunk) => {
      responseData += chunk.toString();
    });

    client.on('end', () => {
      if (!responseData) {
        resolve({ status: 'ok' });
        return;
      }

      try {
        resolve(JSON.parse(responseData));
      } catch (error) {
        resolve({ status: 'ok', raw: responseData });
      }
    });

    client.on('error', reject);
    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error('Device control server timeout'));
    });
  });
}

function computeSpeedFromSamples(samples, fallbackSeconds = 30) {
  if (!samples || samples.length === 0) {
    return { avg_send_speed: 0, avg_receive_speed: 0 };
  }

  if (samples.length === 1) {
    const sample = samples[0];
    return {
      avg_send_speed: Number(sample.bytes_sent_delta || 0) / fallbackSeconds,
      avg_receive_speed: Number(sample.bytes_received_delta || 0) / fallbackSeconds
    };
  }

  const last = samples[samples.length - 1];
  const prev = samples[samples.length - 2];
  const dt = (new Date(last.recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 1000;

  if (dt <= 0) {
    return { avg_send_speed: 0, avg_receive_speed: 0 };
  }

  return {
    avg_send_speed: Number(last.bytes_sent_delta || 0) / dt,
    avg_receive_speed: Number(last.bytes_received_delta || 0) / dt
  };
}

function formatSamplesForChart(samples, timeRange) {
  let cumulativeSent = 0;
  let cumulativeReceived = 0;

  return samples.map((sample, index) => {
    cumulativeSent += Number(sample.bytes_sent_delta || 0);
    cumulativeReceived += Number(sample.bytes_received_delta || 0);

    const date = new Date(sample.recorded_at);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');

    let timestampLabel;
    if (timeRange === '1hour' || timeRange === '6hours') {
      timestampLabel = `${hours}:${minutes}:${seconds}`;
    } else {
      timestampLabel = `${day}.${month} ${hours}:${minutes}`;
    }

    let avgSendSpeed = 0;
    let avgReceiveSpeed = 0;
    if (index > 0) {
      const prev = samples[index - 1];
      const dt = (date.getTime() - new Date(prev.recorded_at).getTime()) / 1000;
      if (dt > 0) {
        avgSendSpeed = Number(sample.bytes_sent_delta || 0) / dt;
        avgReceiveSpeed = Number(sample.bytes_received_delta || 0) / dt;
      }
    }

    return {
      recorded_at: sample.recorded_at,
      timestamp: timestampLabel,
      fullTimestamp: date.toLocaleString('ru-RU'),
      bytesSent: cumulativeSent,
      bytesReceived: cumulativeReceived,
      peakConnections: Number(sample.active_connections || 0),
      avgSendSpeed,
      avgReceiveSpeed,
      date
    };
  });
}

exports.Devices = class Devices extends Service {
  constructor(options, app) {
    super({
      ...options,
      name: 'devices',
      table: 'devices'
    });
    this.app = app;
  }

  async find(params) {
    const { query = {} } = params;
    const knex = this.Model;

    const latestSessions = knex('device_sessions')
      .select(knex.raw('DISTINCT ON (device_id) device_id, assigned_port, last_activity, active_connections, bytes_sent, bytes_received'))
      .where('status', 'active')
      .where('expires_at', '>', knex.fn.now())
      .orderBy('device_id')
      .orderBy('started_at', 'desc')
      .as('device_sessions');
    
    // Build base query
    let knexQuery = knex('devices').select(
      'devices.*',
      'users.username as owner_username',
      'device_sessions.assigned_port as session_port',
      'device_sessions.last_activity',
      'device_sessions.active_connections',
      'device_sessions.bytes_sent',
      'device_sessions.bytes_received'
    )
    .leftJoin('users', 'devices.user_id', 'users.id')
    .leftJoin(latestSessions, 'devices.id', 'device_sessions.device_id');
    
    // Apply filters
    if (query.status) {
      knexQuery = knexQuery.where('devices.status', query.status);
    }
    
    if (query.type) {
      knexQuery = knexQuery.where('devices.type', query.type);
    }
    
    if (query.user_id) {
      knexQuery = knexQuery.where('devices.user_id', query.user_id);
    }
    
    if (query.search) {
      knexQuery = knexQuery.where(function() {
        this.where('devices.device_id', 'ilike', `%${query.search}%`)
          .orWhere('devices.name', 'ilike', `%${query.search}%`)
          .orWhere('devices.description', 'ilike', `%${query.search}%`);
      });
    }
    
    // Apply pagination
    const limit = query.$limit || 50;
    const skip = query.$skip || 0;
    
    knexQuery = knexQuery.limit(limit).offset(skip);
    
    // Apply sorting
    const sortField = query.$sort ? Object.keys(query.$sort)[0] : 'created_at';
    const sortOrder = query.$sort ? Object.values(query.$sort)[0] : -1;
    
    knexQuery = knexQuery.orderBy(sortField, sortOrder === 1 ? 'asc' : 'desc');
    
    // Execute query
    const devices = await knexQuery;
    
    // Calculate connectivity status
    const result = devices.map(device => enrichDeviceWithOnline(device));
    
    // Get total count for pagination
    const countQuery = this.Model('devices').count('* as count');
    
    // Apply same filters to count query
    if (query.status) {
      countQuery.where('status', query.status);
    }
    
    if (query.type) {
      countQuery.where('type', query.type);
    }
    
    if (query.user_id) {
      countQuery.where('user_id', query.user_id);
    }
    
    if (query.search) {
      countQuery.where(function() {
        this.where('device_id', 'ilike', `%${query.search}%`)
          .orWhere('name', 'ilike', `%${query.search}%`)
          .orWhere('description', 'ilike', `%${query.search}%`);
      });
    }
    
    const total = await countQuery.first();
    
    return {
      data: result,
      limit,
      skip,
      total: total.count
    };
  }

  async get(id, params) {
    const knex = this.Model;
    const device = await knex('devices')
      .select(
        'devices.*',
        'users.username as owner_username',
        'users.email as owner_email'
      )
      .leftJoin('users', 'devices.user_id', 'users.id')
      .where('devices.id', id)
      .first();
    
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Get active session if exists
    const session = await knex('device_sessions')
      .where({ device_id: id, status: 'active' })
      .where('expires_at', '>', knex.raw('NOW()'))
      .first();
    
    if (session) {
      device.session = {
        assigned_port: session.assigned_port,
        last_activity: session.last_activity,
        active_connections: session.active_connections,
        bytes_sent: session.bytes_sent,
        bytes_received: session.bytes_received
      };
    }
    
    return enrichDeviceWithOnline(device);
  }

  async create(data, params) {
    const { user } = params;
    const knex = this.Model;
    
    // Generate device ID if not provided
    const deviceId = data.device_id || `device-${uuidv4().substring(0, 8)}`;
    
    // Generate authentication token
    const authToken = crypto.randomBytes(32).toString('hex');
    const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');
    
    // Prepare device data
    const deviceData = {
      id: uuidv4(),
      device_id: deviceId,
      name: data.name || deviceId,
      description: data.description || '',
      type: data.type || 'iot_gateway',
      status: 'pending',
      auth_token_hash: authTokenHash,
      internal_address: data.internal_address || '127.0.0.1',
      internal_port: data.internal_port || null,
      protocol: data.protocol || 'tcp',
      capabilities: JSON.stringify(data.capabilities || ['tcp']),
      metadata: JSON.stringify(data.metadata || {}),
      user_id: user.id || data.user_id,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    // Insert device
    await knex('devices').insert(deviceData);
    
    // Return device with auth token (only shown once)
    return {
      ...deviceData,
      auth_token: authToken, // Only returned on creation
      auth_token_hash: undefined
    };
  }

  async update(id, data, params) {
    const { user } = params;
    const knex = this.Model;
    
    // Check permissions
    const device = await knex('devices').where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Only admin or device owner can update
    if (!isAdminUser(user) && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }
    
    // Prepare update data
    const updateData = {
      ...data,
      updated_at: new Date()
    };
    
    // Handle JSON fields
    if (data.capabilities) {
      updateData.capabilities = JSON.stringify(data.capabilities);
    }
    
    if (data.metadata) {
      updateData.metadata = JSON.stringify(data.metadata);
    }
    
    // Don't update sensitive fields through regular update
    delete updateData.auth_token_hash;
    delete updateData.device_id; // Device ID should not be changed
    
    // Perform update
    await knex('devices').where('id', id).update(updateData);
    
    // Return updated device
    return this.get(id, params);
  }

  async patch(id, data, params) {
    return this.update(id, data, params);
  }

  async remove(id, params) {
    const { user } = params;
    const knex = this.Model;
    
    // Check permissions
    const device = await knex('devices').where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Only admin or device owner can delete
    if (!isAdminUser(user) && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }
    
    // Delete device (cascade will delete sessions and statistics)
    await knex('devices').where('id', id).del();
    
    return { message: 'Device deleted successfully' };
  }

  async regenerateToken(id, params) {
    const { user } = params;
    const knex = this.Model;
    
    // Check permissions
    const device = await knex('devices').where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Only admin or device owner can regenerate token
    if (!isAdminUser(user) && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }
    
    // Generate new authentication token
    const authToken = crypto.randomBytes(32).toString('hex');
    const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');
    
    // Update device
    await knex('devices').where('id', id).update({
      auth_token_hash: authTokenHash,
      updated_at: new Date()
    });
    
    return {
      auth_token: authToken,
      message: 'Token regenerated successfully'
    };
  }

  async connect(id, params) {
    const knex = this.Model;
    
    const device = await knex('devices').where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    await knex('devices').where('id', id).update({
      status: 'connecting',
      updated_at: new Date()
    });

    const updatedDevice = await broadcastDeviceById(this.app, id);
    
    return {
      message: 'Device enabled for connection. Start the client with device credentials.',
      device_id: device.device_id,
      status: 'connecting',
      control_port: 8443,
      port_range: '6000-7000',
      device: updatedDevice
    };
  }

  async disconnect(id, params) {
    const { user } = params;
    const knex = this.Model;
    
    // Check if user is authenticated
    if (!user) {
      throw new Error('Authentication required');
    }
    
    // Check permissions
    const device = await knex('devices').where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Only admin or device owner can disconnect
    if (!isAdminUser(user) && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }

    const sessions = await knex('device_sessions')
      .where({ device_id: id, status: 'active' })
      .select('assigned_port');

    // Block re-registration, then stop the live tunnel while sessions are still active in DB.
    await knex('devices').where('id', id).update({
      status: 'inactive',
      assigned_port: null,
      updated_at: new Date()
    });

    try {
      await sendDeviceControlCommand(device.device_id, 'disconnect');
    } catch (error) {
      console.error('Failed to notify device control server:', error.message);
    }

    await knex('device_sessions')
      .where({ device_id: id, status: 'active' })
      .update({ status: 'terminated' });

    for (const session of sessions) {
      if (session.assigned_port) {
        await knex.raw('SELECT free_device_port_pair(?)', [session.assigned_port]);
      }
    }

    const updatedDevice = await broadcastDeviceById(this.app, id);
    
    return {
      message: 'Device disconnected',
      device_id: device.device_id,
      status: 'inactive',
      device: updatedDevice
    };
  }

  async restart(id, params) {
    const { user } = params;
    const knex = this.Model;
    
    // Check if user is authenticated
    if (!user) {
      throw new Error('Authentication required');
    }
    
    // Check permissions
    const device = await knex('devices').where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Only admin or device owner can restart
    if (!isAdminUser(user) && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }
    
    // Update device status
    await knex('devices').where('id', id).update({
      status: 'restarting',
      updated_at: new Date()
    });
    
    return {
      message: 'Device restart initiated',
      device_id: device.device_id,
      status: 'restarting'
    };
  }

  async ping(id, params) {
    const knex = this.Model;
    const device = await knex('devices').where('id', id).first();
    
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Check if device is online (heartbeat within last 2 minutes)
    let online = false;
    let lastSeen = null;
    
    if (device.last_heartbeat) {
      const lastHeartbeat = new Date(device.last_heartbeat);
      const now = new Date();
      const diffMinutes = (now - lastHeartbeat) / (1000 * 60);
      online = diffMinutes < 2;
      lastSeen = device.last_heartbeat;
    }
    
    return {
      device_id: device.device_id,
      online,
      last_seen: lastSeen,
      status: device.status
    };
  }

  async resolveDevice(deviceKey, knex) {
    let device = await knex('devices').where('id', deviceKey).first();
    if (!device) {
      device = await knex('devices').where('device_id', deviceKey).first();
    }
    return device;
  }

  assertDeviceAccess(device, user) {
    if (!device) {
      throw new Error('Device not found');
    }

    const isAdmin = user?.role === 'admin' || user?.role_name === 'admin';
    if (!isAdmin && device.user_id !== user?.id) {
      throw new Error('Permission denied');
    }
  }

  async buildDeviceStatisticsSummaryRows(options = {}) {
    const { deviceIds, userId } = options;
    const knex = this.Model;

    const latestSessions = knex('device_sessions')
      .select(knex.raw(
        'DISTINCT ON (device_id) device_id, assigned_port, last_activity, active_connections, bytes_sent, bytes_received, started_at'
      ))
      .where('status', 'active')
      .where('expires_at', '>', knex.fn.now())
      .orderBy('device_id')
      .orderBy('started_at', 'desc')
      .as('device_sessions');

    let query = knex('devices')
      .select(
        'devices.id',
        'devices.device_id',
        'devices.name',
        'devices.status',
        'devices.user_id',
        'devices.last_heartbeat',
        'devices.assigned_port',
        'device_sessions.assigned_port as session_port',
        'device_sessions.bytes_sent',
        'device_sessions.bytes_received',
        'device_sessions.active_connections',
        'device_sessions.last_activity'
      )
      .leftJoin(latestSessions, 'devices.id', 'device_sessions.device_id')
      .orderBy('devices.device_id', 'asc');

    if (deviceIds?.length) {
      query = query.whereIn('devices.id', deviceIds);
    }

    if (userId) {
      query = query.where('devices.user_id', userId);
    }

    const devices = await query;
    const resolvedDeviceIds = devices.map((device) => device.id);

    let hourlyQuery = knex('device_statistics')
      .select('device_id')
      .sum('bytes_sent as total_bytes_sent')
      .sum('bytes_received as total_bytes_received')
      .max('peak_connections as peak_connections')
      .where('period_start', '>=', knex.raw("date_trunc('hour', NOW())"))
      .groupBy('device_id');

    if (resolvedDeviceIds.length > 0) {
      hourlyQuery = hourlyQuery.whereIn('device_id', resolvedDeviceIds);
    } else {
      hourlyQuery = hourlyQuery.whereRaw('1 = 0');
    }

    const hourlyRows = await hourlyQuery;
    const hourlyMap = {};
    hourlyRows.forEach((row) => {
      hourlyMap[row.device_id] = row;
    });

    let recentSamples = [];
    if (resolvedDeviceIds.length > 0) {
      recentSamples = await knex('device_traffic_samples')
        .whereIn('device_id', resolvedDeviceIds)
        .where('recorded_at', '>=', knex.raw("NOW() - interval '10 minutes'"))
        .orderBy('recorded_at', 'asc');
    }

    const samplesByDevice = {};
    recentSamples.forEach((sample) => {
      if (!samplesByDevice[sample.device_id]) {
        samplesByDevice[sample.device_id] = [];
      }
      samplesByDevice[sample.device_id].push(sample);
    });

    return devices.map((device) => {
      const deviceSamples = samplesByDevice[device.id] || [];
      const speed = computeSpeedFromSamples(deviceSamples.slice(-2));

      return {
        ...device,
        bytes_sent: Number(device.bytes_sent || 0),
        bytes_received: Number(device.bytes_received || 0),
        active_connections: Number(device.active_connections || 0),
        hourly_bytes_sent: Number(hourlyMap[device.id]?.total_bytes_sent || 0),
        hourly_bytes_received: Number(hourlyMap[device.id]?.total_bytes_received || 0),
        peak_connections: Number(
          hourlyMap[device.id]?.peak_connections || device.active_connections || 0
        ),
        avg_send_speed: speed.avg_send_speed,
        avg_receive_speed: speed.avg_receive_speed,
        online: device.last_heartbeat
          ? (Date.now() - new Date(device.last_heartbeat).getTime()) < 2 * 60 * 1000
          : false,
        last_activity: device.last_activity || device.last_heartbeat
      };
    });
  }

  async getStatisticsSummary(params = {}) {
    const { user } = params;
    const isAdmin = user?.role === 'admin' || user?.role_name === 'admin';

    return this.buildDeviceStatisticsSummaryRows({
      userId: !isAdmin && user?.id ? user.id : null
    });
  }

  async getDeviceStatisticsSummaryRow(deviceId) {
    const rows = await this.buildDeviceStatisticsSummaryRows({
      deviceIds: [deviceId]
    });
    return rows[0] || null;
  }

  async getDeviceStatistics(deviceKey, params = {}) {
    const { user } = params;
    const knex = this.Model;
    const device = await this.resolveDevice(deviceKey, knex);
    this.assertDeviceAccess(device, user);

    const hours = Math.min(Number(params.query?.hours) || 24, 168);

    const samples = await knex('device_traffic_samples')
      .where('device_id', device.id)
      .where('recorded_at', '>=', knex.raw("NOW() - ? * interval '1 hour'", [hours]))
      .orderBy('recorded_at', 'asc');

    const history = await knex('device_statistics')
      .where('device_id', device.id)
      .where('period_start', '>=', knex.raw("NOW() - ? * interval '1 hour'", [hours]))
      .orderBy('period_start', 'asc');

    const session = await knex('device_sessions')
      .where({ device_id: device.id, status: 'active' })
      .where('expires_at', '>', knex.fn.now())
      .orderBy('started_at', 'desc')
      .first();

    const formattedHistory = history.map((row) => ({
      period_start: row.period_start,
      period_end: row.period_end,
      bytes_sent: Number(row.bytes_sent || 0),
      bytes_received: Number(row.bytes_received || 0),
      peak_connections: Number(row.peak_connections || 0),
      connection_count: Number(row.connection_count || 0)
    }));

    const summary = formattedHistory.reduce((acc, row) => {
      acc.total_bytes_sent += row.bytes_sent;
      acc.total_bytes_received += row.bytes_received;
      acc.peak_connections = Math.max(acc.peak_connections, row.peak_connections);
      return acc;
    }, {
      period_hours: hours,
      total_bytes_sent: 0,
      total_bytes_received: 0,
      peak_connections: 0
    });

    if (session) {
      summary.peak_connections = Math.max(
        summary.peak_connections,
        Number(session.active_connections || 0)
      );
    }

    const currentSpeed = computeSpeedFromSamples(samples.slice(-2));
    summary.avg_send_speed = currentSpeed.avg_send_speed;
    summary.avg_receive_speed = currentSpeed.avg_receive_speed;

    const formattedSamples = samples.map((row) => ({
      recorded_at: row.recorded_at,
      bytes_sent_delta: Number(row.bytes_sent_delta || 0),
      bytes_received_delta: Number(row.bytes_received_delta || 0),
      active_connections: Number(row.active_connections || 0)
    }));

    return {
      device: {
        id: device.id,
        device_id: device.device_id,
        name: device.name,
        status: device.status,
        last_heartbeat: device.last_heartbeat,
        assigned_port: device.assigned_port,
        internal_port: device.internal_port
      },
      summary,
      current_session: session ? {
        bytes_sent: Number(session.bytes_sent || 0),
        bytes_received: Number(session.bytes_received || 0),
        active_connections: Number(session.active_connections || 0),
        last_activity: session.last_activity,
        assigned_port: session.assigned_port,
        started_at: session.started_at
      } : null,
      samples: formattedSamples,
      history: formattedHistory
    };
  }

  async resetDeviceStatistics(deviceKey, params = {}) {
    const { user } = params;
    const knex = this.Model;
    const device = await this.resolveDevice(deviceKey, knex);
    this.assertDeviceAccess(device, user);

    await knex('device_statistics').where('device_id', device.id).del();
    await knex('device_traffic_samples').where('device_id', device.id).del();
    await knex('device_sessions')
      .where({ device_id: device.id, status: 'active' })
      .update({
        bytes_sent: 0,
        bytes_received: 0,
        active_connections: 0,
        last_activity: knex.fn.now()
      });

    return {
      success: true,
      message: `Statistics reset for device ${device.device_id}`
    };
  }
};