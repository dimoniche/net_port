'use strict';

const fs = require('fs');
const compress = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./logger');

const feathers = require('@feathersjs/feathers');
const configuration = require('@feathersjs/configuration');
const express = require('@feathersjs/express');

const services = require('./services');
const appHooks = require('./app.hooks');

const authentication = require('./authentication');
const socketio = require('@feathersjs/socketio');

const knex = require('./knex');
const configureChannels = require('./channels');
const { configureObservability } = require('./observability');

const app = express(feathers());
const path = require('path');

app.configure(configuration());
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(compress());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from multiple locations
const possiblefrontendFilesPath = [
  path.join(__dirname, '../../frontend_net_port/src/files'),  // Local development
  path.join(__dirname, '../../frontend/files'),                     // Docker container
];

// Try each build path until we find one that exists
let frontendFilesPath = null;
for (const possiblePath of possiblefrontendFilesPath) {
  if (fs.existsSync(possiblePath)) {
    frontendFilesPath = possiblePath;
    console.log(`Using frontend files path: ${frontendFilesPath}`);
    break;
  }
}

// Serve pre-built client files
if (frontendFilesPath) {
  app.use('/files', express.static(frontendFilesPath, {
    setHeaders: (res, filePath) => {
      const filename = path.basename(filePath);
      if (filename.includes('module_net_port_client')) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
    }
  }));
} else {
  console.log('Frontend files directory not found, /files endpoint disabled');
}

const { resolveBuildClientPaths } = require('./client-downloads');

const buildClientPaths = resolveBuildClientPaths();
if (buildClientPaths.length > 0) {
  console.log(`Client download dirs: ${buildClientPaths.join(', ')}`);
}

if (buildClientPaths.length > 0) {
  app.use('/files/build', (req, res, next) => {
    const filename = path.basename(decodeURIComponent(req.path || ''));
    if (!isClientArtifactName(filename)) {
      return next();
    }

    for (const clientDir of buildClientPaths) {
      const filePath = path.join(clientDir, filename);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(stat.size));
        return res.end();
      }
      return res.sendFile(filePath);
    }

    return next();
  });
} else {
  console.log('Build client directory not found, /files/build endpoint disabled');
}

function isClientArtifactName(name) {
  return name.startsWith('module_net_port_client-') && !name.endsWith('.dir');
}

// Serve SSL certificates from multiple possible locations
const possibleSslPaths = [
  path.join(__dirname, '../../../../net_port'),  // Local development
  path.join(__dirname, '../../../..'),           // Docker container (relative from backend to /root/net_port)
  '/root/net_port',                              // Absolute path in Docker
  '../../ssl', 
];

let sslCertPath = null;
for (const possiblePath of possibleSslPaths) {
  const certPath = path.join(possiblePath, 'server.crt');
  if (fs.existsSync(certPath)) {
    sslCertPath = possiblePath;
    console.log(`Using SSL certificates path: ${sslCertPath}`);
    break;
  }
}

// Only serve SSL certificates if path exists
if (sslCertPath) {
  app.use('/files/ssl', express.static(sslCertPath, {
    setHeaders: (res, filePath) => {
      const filename = path.basename(filePath);
      if (filename.includes('server.crt') || filename.includes('server.key')) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
    }
  }));
} else {
  console.log('SSL certificates directory not found, /files/ssl endpoint disabled');
}

// Set up Plugins and providers
app.configure(express.rest());
app.configure(
  socketio({
    cors: {
      origin: true,
      methods: ['GET', 'POST']
    }
  })
);

app.configure(knex);

app.configure(authentication);
app.configure(services);
app.configure(configureChannels);
configureObservability(app);

// Configure a middleware for 404s and the error handler
app.use(express.notFound());
app.use(express.errorHandler({ logger }));

app.hooks(appHooks);

module.exports = app;
