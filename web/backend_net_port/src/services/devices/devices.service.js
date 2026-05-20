// Device management service for net_port system
const { Service } = require('feathers-knex');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

exports.Devices = class Devices extends Service {
  constructor(options) {
    super({
      ...options,
      name: 'devices'
    });
  }

  async find(params) {
    const { query = {} } = params;
    const knex = this.Model;
    
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
    .leftJoin('device_sessions', function() {
      this.on('devices.id', '=', 'device_sessions.device_id')
        .andOn('device_sessions.status', '=', knex.raw("'active'"))
        .andOn('device_sessions.expires_at', '>', knex.raw('NOW()'));
    });
    
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
    const result = devices.map(device => {
      const deviceObj = { ...device };
      
      // Determine connectivity status
      if (!device.last_heartbeat) {
        deviceObj.connectivity_status = 'never';
      } else {
        const lastHeartbeat = new Date(device.last_heartbeat);
        const now = new Date();
        const diffMinutes = (now - lastHeartbeat) / (1000 * 60);
        
        if (diffMinutes < 5) {
          deviceObj.connectivity_status = 'online';
        } else if (diffMinutes < 60) {
          deviceObj.connectivity_status = 'recent';
        } else {
          deviceObj.connectivity_status = 'offline';
        }
        
        deviceObj.seconds_since_heartbeat = Math.floor((now - lastHeartbeat) / 1000);
      }
      
      // Hide sensitive data
      delete deviceObj.auth_token_hash;
      
      return deviceObj;
    });
    
    // Get total count for pagination
    const countQuery = this.Model.count('* as count');
    
    if (query.status) {
      countQuery.where('status', query.status);
    }
    
    if (query.type) {
      countQuery.where('type', query.type);
    }
    
    if (query.user_id) {
      countQuery.where('user_id', query.user_id);
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
    const device = await this.Model.select(
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
    const session = await this.Model.knex('device_sessions')
      .select('*')
      .where('device_id', id)
      .where('status', 'active')
      .where('expires_at', '>', this.Model.knex.raw('NOW()'))
      .first();
    
    // Get statistics
    const stats = await this.Model.knex('device_statistics')
      .select(
        this.Model.knex.raw('SUM(bytes_sent) as total_bytes_sent'),
        this.Model.knex.raw('SUM(bytes_received) as total_bytes_received'),
        this.Model.knex.raw('SUM(connection_count) as total_connections'),
        this.Model.knex.raw('AVG(average_latency_ms) as avg_latency')
      )
      .where('device_id', id)
      .first();
    
    // Hide sensitive data
    delete device.auth_token_hash;
    
    return {
      ...device,
      session,
      statistics: stats
    };
  }

  async create(data, params) {
    const { user } = params;
    
    if (!user) {
      throw new Error('Authentication required');
    }
    
    // Generate device ID if not provided
    if (!data.device_id) {
      data.device_id = `device-${uuidv4().substring(0, 8)}`;
    }
    
    // Generate authentication token
    const authToken = crypto.randomBytes(32).toString('hex');
    const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');
    
    // Prepare device data
    const deviceData = {
      id: uuidv4(),
      device_id: data.device_id,
      name: data.name || `Device ${data.device_id}`,
      description: data.description || '',
      type: data.type || 'iot_gateway',
      status: 'inactive',
      auth_token_hash: authTokenHash,
      internal_address: data.internal_address || '127.0.0.1',
      internal_port: data.internal_port || 22,
      protocol: data.protocol || 'tcp',
      capabilities: JSON.stringify(data.capabilities || ['tcp']),
      metadata: JSON.stringify(data.metadata || {}),
      user_id: user.id || data.user_id,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    // Insert device
    await this.Model.insert(deviceData);
    
    // Return device with auth token (only shown once)
    return {
      ...deviceData,
      auth_token: authToken, // Only returned on creation
      auth_token_hash: undefined
    };
  }

  async update(id, data, params) {
    const { user } = params;
    
    // Check permissions
    const device = await this.Model.where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Only admin or device owner can update
    if (user.role !== 'admin' && device.user_id !== user.id) {
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
    await this.Model.where('id', id).update(updateData);
    
    // Return updated device
    return this.get(id, params);
  }

  async patch(id, data, params) {
    return this.update(id, data, params);
  }

  async remove(id, params) {
    const { user } = params;
    
    // Check permissions
    const device = await this.Model.where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Only admin or device owner can delete
    if (user.role !== 'admin' && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }
    
    // Delete device (cascade will delete sessions and statistics)
    await this.Model.where('id', id).del();
    
    return { id, deleted: true };
  }

  // Custom methods
  async regenerateToken(id, params) {
    const { user } = params;
    
    // Check permissions
    const device = await this.Model.where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    if (user.role !== 'admin' && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }
    
    // Generate new token
    const authToken = crypto.randomBytes(32).toString('hex');
    const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');
    
    // Update device
    await this.Model.where('id', id).update({
      auth_token_hash: authTokenHash,
      updated_at: new Date()
    });
    
    return {
      device_id: device.device_id,
      auth_token: authToken,
      message: 'Token regenerated successfully'
    };
  }

  async getSessions(id, params) {
    const sessions = await this.Model.knex('device_sessions')
      .select('*')
      .where('device_id', id)
      .orderBy('started_at', 'desc')
      .limit(params.query.$limit || 50);
    
    return sessions;
  }

  async getStatistics(id, params) {
    const { query = {} } = params;
    const { period = 'day', from, to } = query;
    
    let dateRange;
    const now = new Date();
    
    switch (period) {
      case 'hour':
        dateRange = { start: new Date(now - 3600000), end: now };
        break;
      case 'day':
        dateRange = { start: new Date(now - 86400000), end: now };
        break;
      case 'week':
        dateRange = { start: new Date(now - 604800000), end: now };
        break;
      case 'month':
        dateRange = { start: new Date(now - 2592000000), end: now };
        break;
      case 'year':
        dateRange = { start: new Date(now - 31536000000), end: now };
        break;
      default:
        if (from && to) {
          dateRange = { start: new Date(from), end: new Date(to) };
        } else {
          dateRange = { start: new Date(now - 86400000), end: now };
        }
    }
    
    const stats = await this.Model.knex('device_statistics')
      .select(
        'period_start',
        'period_end',
        'bytes_sent',
        'bytes_received',
        'connection_count',
        'uptime_seconds',
        'peak_connections',
        'average_latency_ms'
      )
      .where('device_id', id)
      .where('period_start', '>=', dateRange.start)
      .where('period_end', '<=', dateRange.end)
      .orderBy('period_start', 'asc');
    
    // Calculate totals
    const totals = stats.reduce((acc, stat) => {
      acc.bytes_sent += parseInt(stat.bytes_sent) || 0;
      acc.bytes_received += parseInt(stat.bytes_received) || 0;
      acc.connection_count += parseInt(stat.connection_count) || 0;
      acc.uptime_seconds += parseInt(stat.uptime_seconds) || 0;
      acc.peak_connections = Math.max(acc.peak_connections, parseInt(stat.peak_connections) || 0);
      return acc;
    }, {
      bytes_sent: 0,
      bytes_received: 0,
      connection_count: 0,
      uptime_seconds: 0,
      peak_connections: 0
    });
    
    return {
      period: {
        start: dateRange.start,
        end: dateRange.end
      },
      data: stats,
      totals
    };
  }

  async restart(id, params) {
    const { user } = params;
    
    // Check permissions
    const device = await this.Model.where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    if (user.role !== 'admin' && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }
    
    // In a real implementation, this would send a command to the device manager
    // to restart the device connection and allocate a new port
    
    return {
      device_id: device.device_id,
      message: 'Device restart command sent',
      timestamp: new Date()
    };
  }

  async disconnect(id, params) {
    const { user } = params;
    
    // Check permissions
    const device = await this.Model.where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    if (user.role !== 'admin' && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }
    
    // Terminate active sessions
    await this.Model.knex('device_sessions')
      .where('device_id', id)
      .where('status', 'active')
      .update({
        status: 'terminated',
        expires_at: new Date()
      });
    
    // Update device status
    await this.Model.where('id', id).update({
      status: 'inactive',
      assigned_port: null,
      updated_at: new Date()
    });
    
    return {
      device_id: device.device_id,
      message: 'Device disconnected',
      timestamp: new Date()
    };
  }

  async ping(id, params) {
    const device = await this.Model.where('id', id).first();
    
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Check if device has recent heartbeat
    const now = new Date();
    const lastHeartbeat = device.last_heartbeat ? new Date(device.last_heartbeat) : null;
    
    const online = lastHeartbeat && (now - lastHeartbeat) < 300000; // 5 minutes
    
    return {
      online,
      last_heartbeat: lastHeartbeat,
      latency_ms: online ? 50 : null, // This would be measured in real implementation
      device_status: device.status
    };
  }
};