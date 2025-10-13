#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

/**
 * Build OpenZL CLI during npm install
 * This requires CMake and build tools on the user's machine
 */

function checkBuildTools() {
  try {
    // Check for CMake
    execSync('cmake --version', { stdio: 'ignore' });
    console.log('✓ CMake found');
  } catch (error) {
    console.error('✗ CMake not found. Please install CMake to build OpenZL CLI.');
    console.error('  - macOS: brew install cmake');
    console.error('  - Ubuntu: sudo apt-get install cmake');
    console.error('  - Windows: Download from https://cmake.org/download/');
    process.exit(1);
  }

  try {
    // Check for C++ compiler
    if (os.platform() === 'win32') {
      execSync('cl', { stdio: 'ignore' });
    } else {
      execSync('gcc --version', { stdio: 'ignore' });
    }
    console.log('✓ C++ compiler found');
  } catch (error) {
    console.error('✗ C++ compiler not found. Please install a C++ compiler.');
    console.error('  - macOS: xcode-select --install');
    console.error('  - Ubuntu: sudo apt-get install build-essential');
    console.error('  - Windows: Install Visual Studio Build Tools');
    process.exit(1);
  }
}

function buildOpenZL() {
  console.log('Building OpenZL CLI...');
  
  const openzlDir = path.join(__dirname, '..', '..', 'openzl');
  
  if (!fs.existsSync(openzlDir)) {
    console.error('Error: OpenZL source directory not found');
    process.exit(1);
  }

  try {
    // Change to OpenZL directory
    process.chdir(openzlDir);
    
    // Build using Makefile (works on Unix-like systems)
    if (os.platform() !== 'win32') {
      execSync('make zli BUILD_TYPE=OPT', { stdio: 'inherit' });
    } else {
      // Windows build with CMake
      execSync('cmake -B build -DCMAKE_BUILD_TYPE=Release', { stdio: 'inherit' });
      execSync('cmake --build build --target zli', { stdio: 'inherit' });
    }
    
    // Find the built binary
    let binaryPath;
    if (os.platform() === 'win32') {
      binaryPath = path.join(openzlDir, 'build', 'cli', 'zli.exe');
    } else {
      // Find the binary in cachedObjs
      const findResult = execSync('find . -name "zli" -type f', { encoding: 'utf8' });
      binaryPath = findResult.trim().split('\n')[0];
    }
    
    if (!binaryPath || !fs.existsSync(binaryPath)) {
      throw new Error('Built binary not found');
    }
    
    // Copy to package
    const platform = os.platform();
    const arch = os.arch();
    const binaryDir = `${platform}-${arch}`;
    const targetDir = path.join(__dirname, '..', 'build', 'binaries', binaryDir);
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    const targetPath = path.join(targetDir, os.platform() === 'win32' ? 'zli.exe' : 'zli');
    fs.copyFileSync(binaryPath, targetPath);
    
    // Make executable on Unix-like systems
    if (os.platform() !== 'win32') {
      fs.chmodSync(targetPath, '755');
    }
    
    console.log(`✓ Successfully built and copied binary to ${targetPath}`);
    
    // Test the binary
    const version = execSync(`"${targetPath}" --version`, { encoding: 'utf8' });
    console.log(`✓ Binary test successful: ${version.trim()}`);
    
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  console.log('@openzl/cli: Building OpenZL CLI from source...');
  checkBuildTools();
  buildOpenZL();
  console.log('@openzl/cli: Build completed successfully!');
}

module.exports = { checkBuildTools, buildOpenZL };
