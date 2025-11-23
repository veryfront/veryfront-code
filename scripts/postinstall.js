#!/usr/bin/env node

/**
 * Post-install script for Veryfront CLI
 * Downloads the correct pre-compiled binary for the user's platform
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const platform = os.platform();
const arch = os.arch();
const version = require('../package.json').version;

// Map platform/arch to binary names
const binaryMap = {
  'darwin-x64': 'veryfront-macos-x64',
  'darwin-arm64': 'veryfront-macos-arm64',
  'linux-x64': 'veryfront-linux-x64',
  'linux-arm64': 'veryfront-linux-arm64',
  'win32-x64': 'veryfront-windows-x64.exe',
};

const platformKey = `${platform}-${arch}`;
const binaryName = binaryMap[platformKey];

if (!binaryName) {
  console.error(`❌ Unsupported platform: ${platform}-${arch}`);
  console.error('Supported platforms:', Object.keys(binaryMap).join(', '));
  process.exit(1);
}

const binDir = path.join(__dirname, '..', 'bin');
const binPath = path.join(binDir, platform === 'win32' ? 'veryfront.exe' : 'veryfront');

// Create bin directory if it doesn't exist
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// GitHub release URL (update with your org/repo)
const baseUrl = `https://github.com/veryfront/veryfront/releases/download/v${version}`;
const url = `${baseUrl}/${binaryName}`;

console.log('📦 Installing Veryfront CLI...');
console.log(`   Platform: ${platform}-${arch}`);
console.log(`   Version: ${version}`);

function downloadBinary(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', reject);
      } else if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
      }
    }).on('error', reject);

    file.on('error', (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function install() {
  try {
    console.log(`⬇️  Downloading binary from ${url}...`);
    await downloadBinary(url, binPath);

    // Make binary executable (Unix systems)
    if (platform !== 'win32') {
      fs.chmodSync(binPath, 0o755);
    }

    console.log('✅ Veryfront CLI installed successfully!');
    console.log('\n🚀 Get started:');
    console.log('   npx veryfront --help');
    console.log('   npx veryfront create my-app');

  } catch (error) {
    console.error('❌ Installation failed:', error.message);
    console.error('\n📝 Manual installation:');
    console.error('   1. Download the binary from GitHub releases');
    console.error('   2. Place it in your PATH as "veryfront"');
    console.error(`   3. URL: ${url}`);
    process.exit(1);
  }
}

install();
