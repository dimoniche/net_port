// Device service hooks
const { authenticate } = require('@feathersjs/authentication').hooks;

// Validation schema
const deviceSchema = {
  properties: {
    device_id: { type: 'string', minLength: 3, maxLength: 64 },
    name: { type: 'string', maxLength: 255 },
    description: { type: 'string' },
    type: { type: 'string', enum: ['iot_gateway', 'sensor', 'camera', 'router', 'other'] },
    internal_address: { type: 'string', format: 'ipv4' },
    internal_port: { type: 'integer', minimum: 6000, maximum: 7000 },
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
      // Check permissions
      async context => {
        const { user } = context.params;
        const { id } = context;
        
        if (user && user.role !== 'admin') {
          const device = await context.app.service('devices').get(id);
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
        
        // Ensure data exists
        if (!data) {
          throw new Error('Device data is required');
        }
        
        // Set user_id if not provided
        if (!data.user_id && user) {
          data.user_id = user.id;
        }
        
        // Validate against schema if validator is available
        const validator = context.app.get('validator');
        if (validator && typeof validator.compile === 'function') {
          const validate = validator.compile(deviceSchema);
          const valid = validate(data);
          
          if (!valid) {
            throw new Error(`Validation failed: ${validate.errors.map(e => e.message).join(', ')}`);
          }
        } else {
          // Basic validation if no validator is configured
          if (!data.device_id) {
            throw new Error('device_id is required');
          }
          if (data.device_id && (data.device_id.length < 3 || data.device_id.length > 64)) {
            throw new Error('device_id must be between 3 and 64 characters');
          }
        }
        
        return context;
      }
    ],
    update: [
      // Check permissions and validate
      async context => {
        const { id, data, params } = context;
        const { user } = params;
        
        // Ensure data exists
        if (!data) {
          throw new Error('Update data is required');
        }
        
        // Check permissions
        if (user && user.role !== 'admin') {
          const device = await context.app.service('devices').get(id);
          if (device.user_id !== user.id) {
            throw new Error('Permission denied');
          }
        }
        
        // Don't allow changing device_id
        if (data.device_id) {
          delete data.device_id;
        }
        
        // Validate update data if validator is available
        const validator = context.app.get('validator');
        if (validator && typeof validator.compile === 'function') {
          const updateSchema = { ...deviceSchema };
          delete updateSchema.required; // No required fields for update
          
          const validate = validator.compile(updateSchema);
          const valid = validate(data);
          
          if (!valid) {
            throw new Error(`Validation failed: ${validate.errors.map(e => e.message).join(', ')}`);
          }
        }
        // If no validator, skip schema validation for updates
        
        return context;
      }
    ],
    patch: [
      // Same as update
      async context => {
        const { id, data, params } = context;
        const { user } = params;
        
        // Ensure data exists
        if (!data) {
          throw new Error('Patch data is required');
        }
        
        if (user && user.role !== 'admin') {
          const device = await context.app.service('devices').get(id);
          if (device.user_id !== user.id) {
            throw new Error('Permission denied');
          }
        }
        
        // Don't allow changing device_id
        if (data.device_id) {
          delete data.device_id;
        }
        
        return context;
      }
    ],
    remove: [
      // Check permissions
      async context => {
        const { id, params } = context;
        const { user } = params;
        
        if (user && user.role !== 'admin') {
          const device = await context.app.service('devices').get(id);
          if (device.user_id !== user.id) {
            throw new Error('Permission denied');
          }
        }
        
        return context;
      }
    ]
  },

  after: {
    all: [],
    find: [
      // Format response
      async context => {
        return context;
      }
    ],
    get: [
      // Add additional data
      async context => {
        return context;
      }
    ],
    create: [
      // Log device creation
      async context => {
        const { result, params } = context;
        const { user } = params;
        
        // Log event
        await context.app.service('events').create({
          type: 'device_created',
          device_id: result.id,
          user_id: user.id,
          data: {
            device_id: result.device_id,
            name: result.name
          },
          timestamp: new Date()
        });
        
        return context;
      }
    ],
    update: [
      // Log update
      async context => {
        const { result, params } = context;
        const { user } = params;
        
        await context.app.service('events').create({
          type: 'device_updated',
          device_id: result.id,
          user_id: user.id,
          timestamp: new Date()
        });
        
        return context;
      }
    ],
    patch: [
      // Log patch
      async context => {
        const { result, params } = context;
        const { user } = params;
        
        await context.app.service('events').create({
          type: 'device_updated',
          device_id: result.id,
          user_id: user.id,
          timestamp: new Date()
        });
        
        return context;
      }
    ],
    remove: [
      // Log deletion
      async context => {
        const { result, params } = context;
        const { user } = params;
        
        await context.app.service('events').create({
          type: 'device_deleted',
          device_id: result.id,
          user_id: user.id,
          timestamp: new Date()
        });
        
        return context;
      }
    ]
  },

  error: {
    all: [
      // Log errors
      async context => {
        console.error('Device service error:', context.error);
        
        // Log error event if events service exists
        try {
          // Check if events service exists
          const serviceNames = Object.keys(context.app.services);
          if (serviceNames.includes('events')) {
            await context.app.service('events').create({
              type: 'device_error',
              error: context.error.message,
              stack: context.error.stack,
              timestamp: new Date()
            });
          }
        } catch (e) {
          console.error('Failed to log error event:', e);
        }
        
        return context;
      }
    ]
  }
};