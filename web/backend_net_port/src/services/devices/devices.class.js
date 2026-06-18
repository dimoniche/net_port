// Device service class
const { Service } = require('feathers-knex');

exports.Devices = class Devices extends Service {
  constructor(options) {
    super({
      ...options,
      name: 'devices',
      events: ['created', 'updated', 'patched', 'removed'],
      paginate: {
        default: 50,
        max: 1000
      }
    });
  }

  // Custom methods
  async setup(app) {
    this.app = app;
    
    // Create database table if it doesn't exist
    const knex = app.get('knexClient');
    
    const tableExists = await knex.schema.hasTable('devices');
    if (!tableExists) {
      await knex.schema.createTable('devices', table => {
        table.uuid('id').primary();
        table.string('device_id', 64).unique().notNullable();
        table.string('name', 255);
        table.text('description');
        table.string('type', 50).defaultTo('iot_gateway');
        table.string('status', 20).defaultTo('inactive');
        table.string('auth_token_hash', 255).notNullable();
        table.integer('assigned_port').nullable();
        table.string('internal_address', 45);
        table.integer('internal_port');
        table.boolean('enable_input_ssl').notNullable().defaultTo(false);
        table.boolean('enable_tunnel_ssl').notNullable().defaultTo(false);
        table.string('protocol', 10).defaultTo('tcp');
        table.jsonb('capabilities').defaultTo('[]');
        table.jsonb('metadata').defaultTo('{}');
        table.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.timestamp('last_heartbeat').nullable();
        
        table.index('status');
        table.index('user_id');
        table.index('last_heartbeat');
        table.index('assigned_port');
        
        table.check('assigned_port IS NULL OR (assigned_port >= 6000 AND assigned_port <= 7000)', 'valid_port_range');
        table.check('internal_port IS NULL OR (internal_port >= 1 AND internal_port <= 65535)', 'valid_internal_port');
      });
      
      console.log('Created devices table');
    } else {
      const hasInputSsl = await knex.schema.hasColumn('devices', 'enable_input_ssl');
      if (!hasInputSsl) {
        await knex.schema.alterTable('devices', table => {
          table.boolean('enable_input_ssl').notNullable().defaultTo(false);
          table.boolean('enable_tunnel_ssl').notNullable().defaultTo(false);
        });
        console.log('Added per-device TLS columns to devices table');
      }
    }
    
    // Create related tables
    await this.createRelatedTables(knex);
  }

  async createRelatedTables(knex) {
    // Device sessions table
    const sessionsExists = await knex.schema.hasTable('device_sessions');
    if (!sessionsExists) {
      await knex.schema.createTable('device_sessions', table => {
        table.uuid('id').primary();
        table.uuid('device_id').references('id').inTable('devices').onDelete('CASCADE');
        table.string('session_token', 255).unique().notNullable();
        table.string('client_ip', 45);
        table.integer('client_port');
        table.string('server_ip', 45).defaultTo('0.0.0.0');
        table.integer('assigned_port').notNullable();
        table.timestamp('started_at').defaultTo(knex.fn.now());
        table.timestamp('last_activity').defaultTo(knex.fn.now());
        table.timestamp('expires_at').notNullable();
        table.bigInteger('bytes_sent').defaultTo(0);
        table.bigInteger('bytes_received').defaultTo(0);
        table.integer('active_connections').defaultTo(0);
        table.string('status', 20).defaultTo('active');
        
        table.index('device_id');
        table.index('session_token');
        table.index('assigned_port');
        table.index('expires_at');
        table.index('status');
        
        table.check('assigned_port >= 6000 AND assigned_port <= 7000', 'valid_session_port');
      });
      
      console.log('Created device_sessions table');
    }
    
    // Port allocations table
    const portsExists = await knex.schema.hasTable('port_allocations');
    if (!portsExists) {
      await knex.schema.createTable('port_allocations', table => {
        table.integer('port').primary();
        table.uuid('device_id').references('id').inTable('devices').onDelete('SET NULL');
        table.uuid('session_id').references('id').inTable('device_sessions').onDelete('SET NULL');
        table.timestamp('allocated_at').defaultTo(knex.fn.now());
        table.timestamp('expires_at').nullable();
        table.string('status', 20).defaultTo('allocated');
        
        table.index('device_id');
        table.index('status');
        table.index('expires_at');
        
        table.check('port >= 6000 AND port <= 7000', 'valid_port_range');
      });
      
      console.log('Created port_allocations table');
      
      // Initialize with free ports
      await this.initializePortAllocations(knex);
    }
    
    // Device statistics table
    const statsExists = await knex.schema.hasTable('device_statistics');
    if (!statsExists) {
      await knex.schema.createTable('device_statistics', table => {
        table.increments('id').primary();
        table.uuid('device_id').references('id').inTable('devices').onDelete('CASCADE');
        table.timestamp('period_start').notNullable();
        table.timestamp('period_end').notNullable();
        table.bigInteger('bytes_sent').defaultTo(0);
        table.bigInteger('bytes_received').defaultTo(0);
        table.integer('connection_count').defaultTo(0);
        table.integer('uptime_seconds').defaultTo(0);
        table.integer('peak_connections').defaultTo(0);
        table.decimal('average_latency_ms', 10, 2);
        
        table.index('device_id');
        table.index(['device_id', 'period_start']);
        
        table.unique(['device_id', 'period_start']);
        table.check('period_end > period_start', 'valid_period');
      });
      
      console.log('Created device_statistics table');
    }
    
    // Device events table
    const eventsExists = await knex.schema.hasTable('device_events');
    if (!eventsExists) {
      await knex.schema.createTable('device_events', table => {
        table.increments('id').primary();
        table.uuid('device_id').references('id').inTable('devices').onDelete('SET NULL');
        table.string('event_type', 50).notNullable();
        table.jsonb('event_data');
        table.string('ip_address', 45);
        table.text('user_agent');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        
        table.index(['device_id', 'event_type']);
        
        console.log('Created device_events table');
      });
    }
  }

  async initializePortAllocations(knex) {
    // Insert free ports (6000-7000)
    const batchSize = 1000;
    const startPort = 6000;
    const endPort = 7000;
    
    console.log(`Initializing port allocations (${startPort}-${endPort})...`);
    
    for (let port = startPort; port <= endPort; port += batchSize) {
      const batchEnd = Math.min(port + batchSize - 1, endPort);
      const ports = [];
      
      for (let p = port; p <= batchEnd; p++) {
        ports.push({ port: p, status: 'free' });
      }
      
      await knex('port_allocations').insert(ports).onConflict('port').ignore();
      
      if (port % 10000 === 0) {
        console.log(`  Initialized ports up to ${batchEnd}`);
      }
    }
    
    console.log('Port allocations initialized');
  }

  // Custom service methods
  async customFind(params) {
    // This is an example of a custom find method
    return this.find(params);
  }

  async getDeviceByToken(authToken) {
    const knex = this.app.get('knexClient');
    
    // Hash the token for comparison
    const crypto = require('crypto');
    const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');
    
    const device = await knex('devices')
      .select('*')
      .where('auth_token_hash', authTokenHash)
      .first();
    
    return device;
  }

  async updateDeviceHeartbeat(deviceId) {
    const knex = this.app.get('knexClient');
    
    await knex('devices')
      .where('id', deviceId)
      .update({
        last_heartbeat: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    
    return { success: true };
  }

  async getDeviceStatsSummary() {
    const knex = this.app.get('knexClient');
    
    const stats = await knex('devices')
      .select(
        knex.raw('COUNT(*) as total_devices'),
        knex.raw('SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as active_devices', ['active']),
        knex.raw('SUM(CASE WHEN last_heartbeat > NOW() - INTERVAL ? THEN 1 ELSE 0 END) as online_devices', ['5 minutes']),
        knex.raw('COUNT(DISTINCT assigned_port) as ports_used')
      )
      .first();
    
    return stats;
  }

  async getPortUsage() {
    const knex = this.app.get('knexClient');
    
    const usage = await knex('port_allocations')
      .select('status', knex.raw('COUNT(*) as count'))
      .groupBy('status');
    
    const total = await knex('port_allocations').count('* as total').first();
    
    return {
      usage,
      total: total.total
    };
  }
};