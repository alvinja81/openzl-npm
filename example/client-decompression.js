import fetch from 'node-fetch';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * OpenZL Client Decompression Example
 * This shows how to fetch compressed data and decompress it
 */

class OpenZLClient {
  constructor() {
    this.baseUrl = 'http://localhost:3000';
  }

  /**
   * Fetch and decompress OpenZL data using the CLI tool
   */
  async fetchAndDecompress(endpoint) {
    try {
      console.log(`🔄 Fetching compressed data from ${endpoint}...`);
      
      // Fetch the compressed data
      const response = await fetch(`${this.baseUrl}${endpoint}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get compression info from headers
      const compressionRatio = response.headers.get('X-OpenZL-Ratio');
      const originalSize = response.headers.get('X-Original-Size');
      const compressedSize = response.headers.get('X-Compressed-Size');
      
      console.log(`📊 Compression Stats:`);
      console.log(`   Original Size: ${originalSize} bytes`);
      console.log(`   Compressed Size: ${compressedSize} bytes`);
      console.log(`   Compression Ratio: ${compressionRatio}`);

      // Get the compressed buffer
      const compressedBuffer = await response.buffer();
      
      // Save compressed data to temporary file
      const tempFile = path.join(process.cwd(), 'temp_compressed.zl');
      fs.writeFileSync(tempFile, compressedBuffer);
      
      console.log(`💾 Saved compressed data to ${tempFile}`);
      
      // Decompress using OpenZL CLI
      const decompressedData = await this.decompressWithCLI(tempFile);
      
      // Clean up temp file
      fs.unlinkSync(tempFile);
      
      return {
        data: JSON.parse(decompressedData),
        stats: {
          originalSize: parseInt(originalSize),
          compressedSize: parseInt(compressedSize),
          ratio: parseFloat(compressionRatio)
        }
      };
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      throw error;
    }
  }

  /**
   * Decompress using OpenZL CLI tool
   */
  async decompressWithCLI(inputFile) {
    return new Promise((resolve, reject) => {
      // Try to find the OpenZL CLI binary
      const possiblePaths = [
        path.join(process.cwd(), 'openzl', 'zli'),
        path.join(process.cwd(), 'openzl', 'build', 'binaries', 'darwin-arm64', 'zli'),
        path.join(process.cwd(), 'openzl', 'build', 'binaries', 'darwin-x64', 'zli'),
        path.join(process.cwd(), 'openzl', 'build', 'binaries', 'linux-x64', 'zli'),
        'zli' // If installed globally
      ];

      let zliPath = null;
      for (const path of possiblePaths) {
        if (fs.existsSync(path)) {
          zliPath = path;
          break;
        }
      }

      if (!zliPath) {
        reject(new Error('OpenZL CLI tool not found. Please build it first.'));
        return;
      }

      console.log(`🔧 Using OpenZL CLI: ${zliPath}`);

      // Run decompression
      const child = spawn(zliPath, ['decompress', inputFile, '-'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let error = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        error += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Decompression successful!');
          resolve(output);
        } else {
          reject(new Error(`Decompression failed with code ${code}: ${error}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to start decompression: ${err.message}`));
      });
    });
  }

  /**
   * Compare compressed vs uncompressed endpoints
   */
  async compareEndpoints() {
    console.log('🔍 Comparing compressed vs uncompressed endpoints...\n');

    try {
      // Test uncompressed endpoint
      console.log('📥 Testing uncompressed endpoint...');
      const start1 = Date.now();
      const uncompressedResponse = await fetch(`${this.baseUrl}/api/large-raw`);
      const uncompressedData = await uncompressedResponse.json();
      const uncompressedTime = Date.now() - start1;
      
      console.log(`   ✅ Uncompressed: ${uncompressedData.total.length} users`);
      console.log(`   ⏱️  Time: ${uncompressedTime}ms`);
      console.log(`   📏 Size: ${JSON.stringify(uncompressedData).length} bytes\n`);

      // Test compressed endpoint
      console.log('📥 Testing compressed endpoint...');
      const start2 = Date.now();
      const compressedResult = await this.fetchAndDecompress('/api/large');
      const compressedTime = Date.now() - start2;
      
      console.log(`   ✅ Compressed: ${compressedResult.data.total.length} users`);
      console.log(`   ⏱️  Time: ${compressedTime}ms`);
      console.log(`   📏 Original Size: ${compressedResult.stats.originalSize} bytes`);
      console.log(`   📏 Compressed Size: ${compressedResult.stats.compressedSize} bytes`);
      console.log(`   📊 Compression Ratio: ${compressedResult.stats.ratio}%\n`);

      // Calculate savings
      const bandwidthSaved = compressedResult.stats.originalSize - compressedResult.stats.compressedSize;
      const bandwidthSavedPercent = ((bandwidthSaved / compressedResult.stats.originalSize) * 100).toFixed(2);
      
      console.log('🎯 Summary:');
      console.log(`   💾 Bandwidth Saved: ${bandwidthSaved} bytes (${bandwidthSavedPercent}%)`);
      console.log(`   ⚡ Speed Difference: ${uncompressedTime - compressedTime}ms`);
      
    } catch (error) {
      console.error('❌ Comparison failed:', error.message);
    }
  }
}

// Example usage
async function main() {
  const client = new OpenZLClient();
  
  console.log('🚀 OpenZL Client Decompression Demo\n');
  
  try {
    await client.compareEndpoints();
  } catch (error) {
    console.error('Demo failed:', error.message);
    console.log('\n💡 Make sure:');
    console.log('   1. Server is running on http://localhost:3000');
    console.log('   2. OpenZL CLI is built and available');
    console.log('   3. You have the required dependencies installed');
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { OpenZLClient };

