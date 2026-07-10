#!/usr/bin/env node

/**
 * Post-install script for openzl-cli.
 * Purely informational + chmod: the bin/zli launcher resolves the platform
 * binary at runtime, so nothing here is required for the package to work.
 * This script must NEVER fail the install (always exits 0).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function main() {
  const platform = os.platform();
  const arch = os.arch();
  const binaryDir = `${platform}-${arch}`;
  const binaryName = platform === 'win32' ? 'zli.exe' : 'zli';
  const binaryPath = path.join(__dirname, '..', 'build', 'binaries', binaryDir, binaryName);

  if (!fs.existsSync(binaryPath)) {
    const binariesRoot = path.join(__dirname, '..', 'build', 'binaries');
    const available = fs.existsSync(binariesRoot) ? fs.readdirSync(binariesRoot) : [];
    console.warn(`openzl-cli: no prebuilt OpenZL binary for ${binaryDir}.`);
    console.warn(`openzl-cli: bundled platforms: ${available.length ? available.join(', ') : 'none'}`);
    console.warn('openzl-cli: zli will exit with an error on this machine.');
    console.warn('openzl-cli: openzl-express falls back to gzip automatically.');
    return;
  }

  if (platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath, 0o755);
    } catch (error) {
      console.warn(`openzl-cli: could not chmod binary: ${error.message}`);
    }
  }

  console.log(`openzl-cli: OpenZL binary ready for ${binaryDir}`);
}

try {
  main();
} catch (error) {
  console.warn(`openzl-cli: postinstall warning: ${error.message}`);
}
process.exit(0);
