#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Build script for @openzl/cli
 * Builds OpenZL CLI for different platforms
 */

const OPENZL_DIR = path.join(__dirname, '..', '..', 'openzl');
const BUILD_DIR = path.join(__dirname, '..', 'build', 'binaries');

function getCurrentPlatform() {
  const os = require('os');
  const platform = os.platform();
  const arch = os.arch();
  
  const archMap = {
    'x64': 'x64',
    'arm64': 'arm64',
    'arm': 'arm64'
  };
  
  const mappedArch = archMap[arch] || arch;
  return `${platform}-${mappedArch}`;
}

function buildOpenZL() {
  console.log('Building OpenZL CLI...');
  
  if (!fs.existsSync(OPENZL_DIR)) {
    console.error(`Error: OpenZL directory not found at ${OPENZL_DIR}`);
    process.exit(1);
  }
  
  try {
    // Change to OpenZL directory and build
    process.chdir(OPENZL_DIR);
    
    console.log('Running make zli BUILD_TYPE=OPT...');
    execSync('make zli BUILD_TYPE=OPT', { stdio: 'inherit' });
    
    // Find the built binary
    const findResult = execSync('find . -name "zli" -type f', { encoding: 'utf8' });
    const binaryPath = findResult.trim().split('\n')[0];
    
    if (!binaryPath) {
      throw new Error('Built binary not found');
    }
    
    console.log(`Found built binary at: ${binaryPath}`);
    
    // Copy to current platform directory
    const currentPlatform = getCurrentPlatform();
    const targetDir = path.join(BUILD_DIR, currentPlatform);
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    const targetPath = path.join(targetDir, 'zli');
    fs.copyFileSync(binaryPath, targetPath);
    
    // Make executable
    fs.chmodSync(targetPath, '755');
    
    console.log(`Successfully built and copied binary to ${targetPath}`);
    
    // Test the binary
    const version = execSync(`"${targetPath}" --version`, { encoding: 'utf8' });
    console.log(`Binary test successful: ${version.trim()}`);
    
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exit(1);
  }
}

function createPlaceholderBinaries() {
  console.log('Creating placeholder binaries for other platforms...');
  
  const platforms = [
    'darwin-x64',
    'linux-arm64', 
    'linux-x64',
    'win32-x64'
  ];
  
  const currentPlatform = getCurrentPlatform();
  
  platforms.forEach(platform => {
    if (platform === currentPlatform) return;
    
    const platformDir = path.join(BUILD_DIR, platform);
    if (!fs.existsSync(platformDir)) {
      fs.mkdirSync(platformDir, { recursive: true });
    }
    
    const placeholderPath = path.join(platformDir, 'zli');
    
    // Create a placeholder script that explains the situation
    const placeholderContent = `#!/bin/bash
echo "Error: Binary not available for platform ${platform}"
echo "This is a placeholder. The actual binary needs to be built for this platform."
echo "Current platform: ${currentPlatform}"
echo "Requested platform: ${platform}"
exit 1
`;
    
    fs.writeFileSync(placeholderPath, placeholderContent);
    fs.chmodSync(placeholderPath, '755');
    
    console.log(`Created placeholder for ${platform}`);
  });
}

// Main execution
if (require.main === module) {
  console.log('@openzl/cli build script');
  console.log(`Current platform: ${getCurrentPlatform()}`);
  
  buildOpenZL();
  createPlaceholderBinaries();
  
  console.log('Build completed successfully!');
}

module.exports = { buildOpenZL, getCurrentPlatform };
