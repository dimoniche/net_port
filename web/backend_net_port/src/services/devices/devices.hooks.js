// Device service hooks
const { authenticate } = require('@feathersjs/authentication').hooks;
const {
  emitDeviceRemoved,
  broadcastDeviceById
} = require('./device-events');

// Validation schema
const deviceSchema = {
  properties: {
    device_id: { type: 'string', minLength: 3, maxLength: 64 },
    name: { type: 'string', maxLength: 255 },
    description: { type: 'string' },
    type: { type: 'string', enum: ['iot_gateway', 'sensor', 'camera', 'router', 'other'] },
    internal_address: { type: 'string', maxLength: 45 },
    internal_port: { type: ['integer', 'null'], minimum: 1, maximum: 65535 },
    preferred_port: { type: ['integer', 'null'], minimum: 6000, maximum: 6998 },
    protocol: { type: 'string', enum: ['tcp', 'udp'] },
    capabilities: { type: 'array' },
    metadata: { type: 'object' },
    user_id: { type: 'integer' }
  },
  required: ['device_id']
};

module.exports = {
  before: {
    all: [authenticate('jwt')],
    find: [
      // Apply user filter for non-admin users
      async context => {
        const { user } = context.params;
        
        if (user && user.role !== 'admin') {
          context.params.query = {
            ...context.params.query,
            user_id: user.id
          };
        }
        
        return context;
      }
    ],
    get: [
      // Check permissions - fixed to avoid circular service call
      async context => {
        const { user } = context.params;
        const { id } = context;
        
        if (user && user.role !== 'admin') {
          // Access the database directly through Knex
          const knex = context.app.get('db');
          const device = await knex('devices').where({ id }).first();
          
          if (!device) {
            throw new Error('Device not found');
          }
          
          if (device.user_id !== user.id) {
            throw new Error('Permission denied');
          }
        }
        
        return context;
      }
    ],
    create: [
      // Validate input
      async context => {
        const { data } = context;
        const { user } = context.params;
        
        // Set default values
        if (!data.type) {
          data.type = 'iot_gateway';
        }
        
        if (!data.protocol) {
          data.protocol = 'tcp';
        }
        
        if (!data.capabilities) {
          data.capabilities = ['tcp'];
        }
        
        if (!data.metadata) {
          data.metadata = {};
        }

        if (Object.prototype.hasOwnProperty.call(data, 'preferred_port')) {
          if (data.preferred_port === '' || data.preferred_port === undefined) {
            data.preferred_port = null;
          } else {
            const port = Number(data.preferred_port);
            if (!Number.isInteger(port) || port < 6000 || port > 6998 || port % 2 !== 0) {
              throw new Error('Fixed port must be an even integer between 6000 and 6998');
            }
            data.preferred_port = port;
          }
        }
        
        // Set user_id if not provided
        if (!data.user_id && user) {
          data.user_id = user.id;
        }
        
        return context;
      }
    ],
    update: [
      // Check permissions
      async context => {
        const { user } = context.params;
        const { id } = context;
        
        if (user && user.role !== 'admin') {
          const knex = context.app.get('db');
          const device = await knex('devices').where({ id }).first();
          
          if (!device) {
            throw new Error('Device not found');
          }
          
          if (device.user_id !== user.id) {
            throw new Error('Permission denied');
          }
        }

        if (Object.prototype.hasOwnProperty.call(context.data || {}, 'preferred_port')) {
          const value = context.data.preferred_port;
          if (value === '' || value === undefined) {
            context.data.preferred_port = null;
          } else {
            const port = Number(value);
            if (!Number.isInteger(port) || port < 6000 || port > 6998 || port % 2 !== 0) {
              throw new Error('Fixed port must be an even integer between 6000 and 6998');
            }
            context.data.preferred_port = port;
          }
        }
        
        return context;
      }
    ],
    patch: [
      // Check permissions
      async context => {
        const { user } = context.params;
        const { id } = context;
        
        if (user && user.role !== 'admin') {
          const knex = context.app.get('db');
          const device = await knex('devices').where({ id }).first();
          
          if (!device) {
            throw new Error('Device not found');
          }
          
          if (device.user_id !== user.id) {
            throw new Error('Permission denied');
          }
        }

        if (Object.prototype.hasOwnProperty.call(context.data || {}, 'preferred_port')) {
          const value = context.data.preferred_port;
          if (value === '' || value === undefined) {
            context.data.preferred_port = null;
          } else {
            const port = Number(value);
            if (!Number.isInteger(port) || port < 6000 || port > 6998 || port % 2 !== 0) {
              throw new Error('Fixed port must be an even integer between 6000 and 6998');
            }
            context.data.preferred_port = port;
          }
        }
        
        return context;
      }
    ],
    remove: [
      // Check permissions
      async context => {
        const { user } = context.params;
        const { id } = context;
        const knex = context.app.get('db');
        const device = await knex('devices').where({ id }).first();
        
        if (user && user.role !== 'admin') {
          if (!device) {
            throw new Error('Device not found');
          }
          
          if (device.user_id !== user.id) {
            throw new Error('Permission denied');
          }
        }

        context.params._removedDevice = device;
        
        return context;
      }
    ]
  },
  after: {
    all: [],
    find: [],
    get: [
      // Add session information to device response
      async context => {
        const { result } = context;
        
        if (result) {
          const knex = context.app.get('db');
          const session = await knex('device_sessions')
            .where({ device_id: result.id, status: 'active' })
            .where('expires_at', '>', knex.raw('NOW()'))
            .first();
          
          if (session) {
            result.session = {
              assigned_port: session.assigned_port,
              last_activity: session.last_activity,
              active_connections: session.active_connections,
              bytes_sent: session.bytes_sent,
              bytes_received: session.bytes_received
            };
          }
        }
        
        return context;
      }
    ],
    create: [
      async context => {
        if (context.result?.id) {
          await broadcastDeviceById(context.app, context.result.id);
        }
        return context;
      }
    ],
    update: [
      async context => {
        if (context.result?.id) {
          await broadcastDeviceById(context.app, context.result.id);
        }
        return context;
      }
    ],
    patch: [
      async context => {
        if (context.result?.id) {
          await broadcastDeviceById(context.app, context.result.id);
        }
        return context;
      }
    ],
    remove: [
      async context => {
        if (context.params._removedDevice) {
          emitDeviceRemoved(context.app, context.params._removedDevice);
        }
        return context;
      }
    ]
  },
  error: {
    all: [
      async context => {
        console.error('Device service error:', context.error);
        return context;
      }
    ]
  }
};