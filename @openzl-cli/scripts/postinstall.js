#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Post-install script for @openzl/cli
 * Detects the user's platform and architecture, then copies the appropriate binary
 */

function getPlatformInfo() {
  const platform = os.platform();
  const arch = os.arch();
  
  // Map Node.js arch to our binary naming
  const archMap = {
    'x64': 'x64',
    'arm64': 'arm64',
    'arm': 'arm64' // Some systems report 'arm' for arm64
  };
  
  const mappedArch = archMap[arch] || arch;
  
  // Map platform names to our binary directory structure
  const platformMap = {
    'darwin': 'darwin',
    'linux': 'linux',
    'win32': 'win32'
  };
  
  const mappedPlatform = platformMap[platform] || platform;
  
  return {
    platform: mappedPlatform,
    arch: mappedArch,
    binaryDir: `${mappedPlatform}-${mappedArch}`,
    binaryName: platform === 'win32' ? 'zli.exe' : 'zli'
  };
}

function copyBinary() {
  const { platform, arch, binaryDir, binaryName } = getPlatformInfo();
  
  console.log(`@openzl/cli: Detected platform: ${platform}, architecture: ${arch}`);
  
  const sourceDir = path.join(__dirname, '..', 'build', 'binaries', binaryDir);
  const sourceBinary = path.join(sourceDir, binaryName);
  const targetBinary = path.join(__dirname, '..', 'bin', binaryName);
  
  // Ensure bin directory exists
  const binDir = path.dirname(targetBinary);
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }
  
  // Check if source binary exists
  if (!fs.existsSync(sourceBinary)) {
    console.error(`@openzl/cli: Error - Binary not found for platform ${binaryDir}`);
    console.error(`@openzl/cli: Looking for: ${sourceBinary}`);
    
    // List available platforms
    const binariesDir = path.join(__dirname, '..', 'build', 'binaries');
    if (fs.existsSync(binariesDir)) {
      console.error(`@openzl/cli: Available platforms:`, fs.readdirSync(binariesDir));
    } else {
      console.error(`@openzl/cli: No binaries directory found at ${binariesDir}`);
    }
    process.exit(1);
  }
  
  try {
    // Copy the binary
    fs.copyFileSync(sourceBinary, targetBinary);
    
    // Make it executable (Unix-like systems)
    if (platform !== 'win32') {
      fs.chmodSync(targetBinary, '755');
    }
    
    console.log(`@openzl/cli: Successfully installed zli binary for ${binaryDir}`);
    
    // Test the binary
    const { execFileSync } = require('child_process');
    try {
      const version = execFileSync(targetBinary, ['--version'], { encoding: 'utf8' });
      console.log(`@openzl/cli: Binary test successful: ${version.trim()}`);
    } catch (error) {
      console.warn(`@openzl/cli: Warning - Binary test failed: ${error.message}`);
    }
    
  } catch (error) {
    console.error(`@openzl/cli: Error copying binary: ${error.message}`);
    process.exit(1);
  }
}

// Run the postinstall
if (require.main === module) {
  copyBinary();
}

module.exports = { copyBinary, getPlatformInfo };
