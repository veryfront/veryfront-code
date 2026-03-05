#!/usr/bin/env node

/**
 * Build script to compile Veryfront CLI for all platforms
 * Requires Deno to be installed
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "../..", "dist");
const packageJsonPath = join(__dirname, "../..", "package.json");
const version = JSON.parse(readFileSync(packageJsonPath, "utf-8")).version;

// Ensure dist directory exists
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

console.log("🔨 Building Veryfront CLI binaries...");
console.log(`   Version: ${version}\n`);

// Run the same pre-build pipeline used by deno task build/build:npm
console.log("📝 Running build preparation...");
execSync("deno task build:prepare", { stdio: "inherit" });
console.log("");

const targets = [
  {
    name: "macOS (Intel)",
    target: "x86_64-apple-darwin",
    output: "veryfront-macos-x64",
  },
  {
    name: "macOS (Apple Silicon)",
    target: "aarch64-apple-darwin",
    output: "veryfront-macos-arm64",
  },
  {
    name: "Linux (x64)",
    target: "x86_64-unknown-linux-gnu",
    output: "veryfront-linux-x64",
  },
  {
    name: "Linux (ARM64)",
    target: "aarch64-unknown-linux-gnu",
    output: "veryfront-linux-arm64",
  },
  {
    name: "Windows (x64)",
    target: "x86_64-pc-windows-msvc",
    output: "veryfront-windows-x64.exe",
  },
];

let succeeded = 0;
let failed = 0;

for (const { name, target, output } of targets) {
  const outputPath = join(distDir, output);

  try {
    console.log(`📦 Building ${name}...`);
    execSync(
      `deno compile --allow-all --unstable-net --target ${target} --include src/platform/polyfills --include src/proxy/main.ts --include dist/framework-src --output ${outputPath} cli/main.ts`,
      { stdio: "inherit" },
    );

    const stats = statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`   ✅ ${output} (${sizeMB} MB)\n`);
    succeeded++;

  } catch (error) {
    console.error(`   ❌ Failed to build ${name}`);
    console.error(`   ${error.message}\n`);
    failed++;
  }
}

console.log("═".repeat(50));
console.log(`Build complete: ${succeeded} succeeded, ${failed} failed`);
console.log(`Output directory: ${distDir}`);

if (failed > 0) {
  console.error("\n⚠️  Some builds failed. Check the errors above.");
  process.exit(1);
}

console.log("\n✅ All binaries built successfully!");
console.log("\n📝 Next steps:");
console.log("   1. Test the binaries locally");
console.log("   2. Create a GitHub release with version tag");
console.log("   3. Upload binaries to the release");
console.log("   4. Run: npm publish");
