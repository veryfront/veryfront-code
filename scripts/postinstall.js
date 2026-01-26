#!/usr/bin/env node

/**
 * Post-install script for Veryfront CLI
 * Downloads the correct pre-compiled binary for the user's platform
 */

import { createWriteStream, existsSync, mkdirSync, unlinkSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import os from "node:os";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const platform = os.platform();
const arch = os.arch();
const packageJsonPath = join(__dirname, "..", "package.json");
const version = JSON.parse(readFileSync(packageJsonPath, "utf-8")).version;

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
  // Non-fatal: allow JS fallback for unsupported platforms
  console.warn(`⚠️  No pre-built binary for platform: ${platform}-${arch}`);
  console.warn('   Supported platforms:', Object.keys(binaryMap).join(', '));
  console.warn('   Falling back to bundled JavaScript CLI (slower startup)');
  process.exit(0);
}

const binDir = join(__dirname, "..", "bin");
const binPath = join(binDir, platform === "win32" ? "veryfront.exe" : "veryfront");

// Create bin directory if it doesn't exist
if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

// GitHub release URL (update with your org/repo)
const baseUrl = `https://github.com/veryfront/veryfront/releases/download/v${version}`;
const url = `${baseUrl}/${binaryName}`;

console.log('📦 Installing Veryfront CLI...');
console.log(`   Platform: ${platform}-${arch}`);
console.log(`   Version: ${version}`);

function downloadBinary(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    function follow(currentUrl, redirectCount) {
      if (redirectCount > maxRedirects) {
        reject(new Error("Too many redirects"));
        return;
      }

      https.get(currentUrl, (response) => {
        const statusCode = response.statusCode || 0;

        // Handle HTTP redirects (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const location = response.headers.location;
          if (typeof location !== "string" || location.length === 0) {
            response.resume(); // drain to avoid socket/resource leaks
            reject(new Error("Redirect response missing Location header"));
            return;
          }

          let redirectUrl;
          try {
            redirectUrl = new URL(location, currentUrl).toString();
          } catch {
            response.resume();
            reject(new Error(`Invalid redirect URL: ${location}`));
            return;
          }

          response.resume(); // drain before following redirect
          follow(redirectUrl, redirectCount + 1);
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`Failed to download: ${statusCode} ${response.statusMessage}`));
          return;
        }

        const file = createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        file.on("error", (err) => {
          // Wrap unlink in try/catch to avoid masking the original error
          try {
            if (existsSync(dest)) {
              unlinkSync(dest);
            }
          } catch (cleanupErr) {
            console.warn("   Warning: Failed to clean up partial download:", cleanupErr.message);
          }
          reject(err);
        });
      }).on('error', reject);
    }

    follow(url, 0);
  });
}

async function install() {
  try {
    console.log(`⬇️  Downloading binary from ${url}...`);
    await downloadBinary(url, binPath);

    // Make binary executable (Unix systems)
    if (platform !== "win32") {
      chmodSync(binPath, 0o755);
    }

    console.log('✅ Veryfront CLI installed successfully!');
    console.log('\n🚀 Get started:');
    console.log('   npx veryfront --help');
    console.log('   npx veryfront create my-app');

  } catch (error) {
    // Graceful fallback - bundled JS CLI will be used instead
    console.warn("⚠️  Binary download failed:", error.message);
    console.warn("   Falling back to bundled JavaScript CLI (slower startup)");
    console.warn(`   Binary URL: ${url}`);
    // Don't exit with error - let npm install succeed
    // The bundled JS CLI in bin/veryfront.js will work as fallback
  }
}

install();
