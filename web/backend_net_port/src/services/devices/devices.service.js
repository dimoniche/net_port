// Device management service for net_port system
const { Service } = require('feathers-knex');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

exports.Devices = class Devices extends Service {
  constructor(options) {
    super({
      ...options,
      name: 'devices',
      table: 'devices'
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
      
      // Determine if device is online (heartbeat within last 2 minutes)
      if (device.last_heartbeat) {
        const lastHeartbeat = new Date(device.last_heartbeat);
        const now = new Date();
        const diffMinutes = (now - lastHeartbeat) / (1000 * 60);
        deviceObj.online = diffMinutes < 2;
      } else {
        deviceObj.online = false;
      }
      
      return deviceObj;
    });
    
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
    
    // Determine if device is online
    if (device.last_heartbeat) {
      const lastHeartbeat = new Date(device.last_heartbeat);
      const now = new Date();
      const diffMinutes = (now - lastHeartbeat) / (1000 * 60);
      device.online = diffMinutes < 2;
    } else {
      device.online = false;
    }
    
    return device;
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
      status: 'inactive',
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
    if (user.role !== 'admin' && device.user_id !== user.id) {
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
    if (user.role !== 'admin' && device.user_id !== user.id) {
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
    //const { user } = params;
    const knex = this.Model;
    
    /*// Check if user is authenticated
    if (!user) {
      throw new Error('Authentication required');
    }*/
    
    // Check permissions
    const device = await knex('devices').where('id', id).first();
    if (!device) {
      throw new Error('Device not found');
    }
    
    // Only admin or device owner can connect
    /*if (user.role !== 'admin' && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }*/
    
    // Update device status to connecting
    await knex('devices').where('id', id).update({
      status: 'connecting',
      updated_at: new Date()
    });
    
    // In a real implementation, this would trigger the device to connect
    // For now, we'll simulate a connection
    return {
      message: 'Device connection initiated',
      device_id: device.device_id,
      status: 'connecting'
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
    if (user.role !== 'admin' && device.user_id !== user.id) {
      throw new Error('Permission denied');
    }
    
    // Update device status
    await knex('devices').where('id', id).update({
      status: 'inactive',
      updated_at: new Date()
    });
    
    // Clean up any active sessions
    await knex('device_sessions')
      .where({ device_id: id, status: 'active' })
      .update({ status: 'terminated' });
    
    return {
      message: 'Device disconnected',
      device_id: device.device_id,
      status: 'inactive'
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
    if (user.role !== 'admin' && device.user_id !== user.id) {
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
};