#!/usr/bin/env node
/**
 * Optional install hook for the N-API addon.
 *
 * Fallback chain (never fails the overall npm install):
 *   1. Local prebuilds/{platform}-{arch}/openzl_native.node (published package)
 *   2. Download from GitHub Release (if tag/version has assets)
 *   3. Skip — runtime uses CLI pool / gzip
 *
 * Set OPENZL_SKIP_NATIVE=1 to disable.
 * Set OPENZL_NATIVE_URL to force a direct .node or .tar.gz URL.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = `${process.platform}-${process.arch}`;
const destDir = path.join(root, 'prebuilds', platform);
const destFile = path.join(destDir, 'openzl_native.node');

const log = (...a) => console.log('[openzl-native]', ...a);
const warn = (...a) => console.warn('[openzl-native]', ...a);

if (process.env.OPENZL_SKIP_NATIVE === '1' || process.env.OPENZL_NATIVE === '0') {
  log('skipped (OPENZL_SKIP_NATIVE or OPENZL_NATIVE=0)');
  process.exit(0);
}

if (fs.existsSync(destFile)) {
  log('already present:', destFile);
  process.exit(0);
}

// Also accept cmake-js local build
const localBuild = path.join(root, 'native/build/Release/openzl_native.node');
if (fs.existsSync(localBuild)) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(localBuild, destFile);
  log('copied local build →', destFile);
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const repo =
  (pkg.repository && (pkg.repository.url || pkg.repository)) ||
  'https://github.com/alvinja81/openzl-npm.git';
const repoPath = String(repo)
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')
  .replace(/^https?:\/\/github.com\//, '')
  .replace(/\/$/, '');

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, { headers: { 'User-Agent': 'openzl-express-install' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function downloadTo(url, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buf = await get(url);
  if (url.endsWith('.tar.gz') || url.endsWith('.tgz')) {
    const tmp = file + '.tgz';
    fs.writeFileSync(tmp, buf);
    try {
      execSync(`tar -xzf "${tmp}" -C "${path.dirname(file)}"`, { stdio: 'pipe' });
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
    // tarball may extract openzl_native.node into dir
    if (!fs.existsSync(file)) {
      const found = fs
        .readdirSync(path.dirname(file))
        .find((f) => f.endsWith('.node'));
      if (found) {
        fs.renameSync(path.join(path.dirname(file), found), file);
      }
    }
  } else {
    fs.writeFileSync(file, buf);
  }
}

async function main() {
  const urls = [];

  if (process.env.OPENZL_NATIVE_URL) {
    urls.push(process.env.OPENZL_NATIVE_URL);
  }

  // GitHub release asset naming from build-native.yml
  const tag = `v${version}`;
  const asset = `openzl_native-v${version}-${platform}.tar.gz`;
  urls.push(
    `https://github.com/${repoPath}/releases/download/${tag}/${asset}`
  );

  for (const url of urls) {
    try {
      log('trying', url);
      await downloadTo(url, destFile);
      if (fs.existsSync(destFile)) {
        log('installed', destFile);
        return;
      }
    } catch (e) {
      warn('download failed:', e.message);
    }
  }

  warn(
    `no prebuild for ${platform}. Runtime will use zli CLI / gzip. ` +
      `Optional: npm run build:native (needs OpenZL sources + cmake).`
  );
  process.exit(0);
}

main().catch((e) => {
  warn('install-native error (non-fatal):', e.message);
  process.exit(0);
});
