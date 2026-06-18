'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { listClientDownloads, resolveBuildClientPath } = require('./client-downloads');

const VERSION_FILE_CANDIDATES = [
  path.join(__dirname, '../../../VERSION'),
  path.join(__dirname, '../../../../VERSION'),
  '/root/net_port/source/VERSION'
];

function readPublishedVersion() {
  for (const candidate of VERSION_FILE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8').trim();
    }
  }

  return null;
}

function normalizePlatform(value) {
  const platform = String(value || 'linux').toLowerCase();
  if (platform === 'win' || platform === 'windows') {
    return 'windows';
  }
  return 'linux';
}

function normalizeArch(value) {
  const arch = String(value || 'amd64').toLowerCase();
  if (arch === 'x64' || arch === 'x86_64' || arch === 'amd64') {
    return 'amd64';
  }
  if (arch === 'arm' || arch === 'armv7' || arch === 'armhf') {
    return 'armhf';
  }
  if (arch === 'arm64' || arch === 'aarch64') {
    return 'aarch64';
  }
  return arch;
}

function resolveArtifactFilename(platform, arch, version) {
  const base = `module_net_port_client-${version}`;
  if (platform === 'windows') {
    return `${base}.exe`;
  }
  if (arch === 'armhf') {
    return `${base}-armhf`;
  }
  if (arch === 'aarch64') {
    return `${base}-aarch64`;
  }
  return base;
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function compareVersions(a, b) {
  const left = String(a || '0.0.0').split('.').map((part) => Number(part) || 0);
  const right = String(b || '0.0.0').split('.').map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }

  return 0;
}

function getLatestClientRelease(query = {}) {
  const platform = normalizePlatform(query.platform);
  const arch = normalizeArch(query.arch);
  const version = readPublishedVersion();

  if (!version) {
    return null;
  }

  const filename = resolveArtifactFilename(platform, arch, version);
  const downloads = listClientDownloads();
  const artifact = downloads.find((item) => item.filename === filename);

  if (!artifact) {
    return {
      version,
      platform,
      arch,
      filename,
      available: false
    };
  }

  const clientDir = resolveBuildClientPath();
  const filePath = path.join(clientDir, filename);

  return {
    version,
    platform,
    arch,
    filename,
    available: true,
    size_bytes: artifact.sizeBytes,
    sha256: sha256File(filePath),
    download_path: `/files/build/${filename}`
  };
}

function checkClientUpdate(query = {}) {
  const current = String(query.current || query.version || '').trim();
  const latest = getLatestClientRelease(query);

  if (!latest) {
    return {
      current,
      update_available: false,
      reason: 'version_unavailable'
    };
  }

  if (!latest.available) {
    return {
      current,
      latest,
      update_available: false,
      reason: 'artifact_not_found'
    };
  }

  const updateAvailable =
    !current || compareVersions(current, latest.version) < 0;

  return {
    current: current || null,
    latest,
    update_available: updateAvailable
  };
}

module.exports = {
  readPublishedVersion,
  normalizePlatform,
  normalizeArch,
  resolveArtifactFilename,
  compareVersions,
  getLatestClientRelease,
  checkClientUpdate
};
