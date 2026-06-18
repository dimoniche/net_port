'use strict';

const fs = require('fs');
const path = require('path');

/** Порядок важен: первый каталог с файлом побеждает при дубликатах. */
const CLIENT_SEARCH_DIRS = [
  '/root/net_port/source/build/client',
  path.join(__dirname, '../../../build/client'),
  path.join(__dirname, '../../../artifacts/clients'),
  '/root/net_port/source/artifacts/clients',
  path.join(__dirname, '../../build/client'),
  path.join(__dirname, '../../../../build/client'),
  path.join(__dirname, '../../../../net_port/build/client'),
  '/root/net_port'
];

function isClientArtifactName(name) {
  return name.startsWith('module_net_port_client-') && !name.endsWith('.dir');
}

function dirHasClientBinary(dir) {
  try {
    return fs.readdirSync(dir).some(isClientArtifactName);
  } catch {
    return false;
  }
}

function resolveBuildClientPaths() {
  const seen = new Set();
  const result = [];

  for (const possiblePath of CLIENT_SEARCH_DIRS) {
    const resolved = path.resolve(possiblePath);
    if (seen.has(resolved) || !fs.existsSync(resolved) || !dirHasClientBinary(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }

  return result;
}

function resolveBuildClientPath() {
  const dirs = resolveBuildClientPaths();
  return dirs[0] ?? null;
}

function listClientDownloadFilenames() {
  return listClientDownloads().map((item) => item.filename);
}

function listClientDownloads() {
  const dirs = resolveBuildClientPaths();
  if (dirs.length === 0) {
    return [];
  }

  const byFilename = new Map();

  for (const clientDir of dirs) {
    let names;
    try {
      names = fs.readdirSync(clientDir);
    } catch {
      continue;
    }

    for (const filename of names) {
      if (!isClientArtifactName(filename) || byFilename.has(filename)) {
        continue;
      }

      const filePath = path.join(clientDir, filename);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          continue;
        }
        byFilename.set(filename, { filename, sizeBytes: stat.size });
      } catch {
        // skip unreadable entries
      }
    }
  }

  return Array.from(byFilename.values()).sort((a, b) =>
    a.filename.localeCompare(b.filename)
  );
}

module.exports = {
  resolveBuildClientPath,
  resolveBuildClientPaths,
  listClientDownloadFilenames,
  listClientDownloads
};
