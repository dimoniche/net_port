'use strict';

const fs = require('fs');
const path = require('path');

const possibleBuildPaths = [
  path.join(__dirname, '../../build/client'),
  '/root/net_port/source/build/client',
  path.join(__dirname, '../../../build/client'),
  path.join(__dirname, '../../../../build/client'),
  path.join(__dirname, '../../../../net_port/build/client'),
  '/root/net_port'
];

function resolveBuildClientPath() {
  for (const possiblePath of possibleBuildPaths) {
    if (!fs.existsSync(possiblePath)) {
      continue;
    }
    const hasClientBinary = fs
      .readdirSync(possiblePath)
      .some((name) => name.startsWith('module_net_port_client-') && !name.endsWith('.dir'));
    if (hasClientBinary) {
      return possiblePath;
    }
  }
  return null;
}

function listClientDownloadFilenames() {
  const clientDir = resolveBuildClientPath();
  if (!clientDir) {
    return [];
  }

  return fs
    .readdirSync(clientDir)
    .filter((name) => name.startsWith('module_net_port_client-') && !name.endsWith('.dir'))
    .filter((name) => {
      try {
        return fs.statSync(path.join(clientDir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

module.exports = {
  resolveBuildClientPath,
  listClientDownloadFilenames
};
