'use strict';

function resolveClientRuntimeConfig() {
  const registrationPort = Number(process.env.PUBLIC_REGISTRATION_PORT || 8443);
  const portHostBaseRaw = process.env.PUBLIC_PORT_HOST_BASE;
  const portHostBase = portHostBaseRaw === undefined || portHostBaseRaw === ''
    ? 49000
    : Number(portHostBaseRaw);

  return {
    registration_port: registrationPort,
    port_host_base: Number.isFinite(portHostBase) && portHostBase > 0 ? portHostBase : null
  };
}

function configureClientRuntimeConfig(app) {
  const prefix = app.get('prefix') || '';
  const endpoint = `${prefix}/client-config`;

  app.get(endpoint, (_req, res) => {
    res.json(resolveClientRuntimeConfig());
  });
}

module.exports = {
  resolveClientRuntimeConfig,
  configureClientRuntimeConfig
};
