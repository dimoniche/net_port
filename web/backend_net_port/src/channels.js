'use strict';

function isAdminUser(user) {
  return user?.role === 'admin' || user?.role_name === 'admin';
}

module.exports = function configureChannels(app) {
  if (typeof app.channel !== 'function') {
    return;
  }

  app.on('connection', (connection) => {
    app.channel('anonymous').join(connection);
  });

  app.on('login', (authResult, { connection }) => {
    if (!connection) {
      return;
    }

    const user = authResult.user || authResult;
    if (!user?.id) {
      return;
    }

    app.channel('anonymous').leave(connection);
    app.channel('authenticated').join(connection);
    app.channel(`user:${user.id}`).join(connection);

    if (isAdminUser(user)) {
      app.channel('admin').join(connection);
    }
  });

  app.on('disconnect', (connection) => {
    if (!connection) {
      return;
    }

    app.channel('anonymous').leave(connection);
    app.channel('authenticated').leave(connection);
  });
};
