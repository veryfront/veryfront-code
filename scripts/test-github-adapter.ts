#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Manual test script for GitHubFSAdapter with a real repository
 *
 * Usage:
 *   GITHUB_TOKEN=$(gh auth token) deno run --allow-net --allow-env scripts/test-github-adapter.ts
 */

import { GitHubFSAdapter } from "../src/platform/adapters/github-fs-adapter/index.ts";

const token = Deno.env.get("GITHUB_TOKEN");
if (!token) {
  console.error("ERROR: GITHUB_TOKEN environment variable required");
  console.error("Run: GITHUB_TOKEN=$(gh auth token) deno run --allow-net --allow-env scripts/test-github-adapter.ts");
  Deno.exit(1);
}

const owner = "veryfront";
const repo = "codersociety";

console.log(`\n🧪 Testing GitHubFSAdapter with ${owner}/${repo}\n`);

const adapter = new GitHubFSAdapter({
  type: "github",
  github: {
    token,
    owner,
    repo,
    ref: "main",
  },
});

try {
  // Test 1: Initialize
  console.log("1️⃣  Initializing adapter...");
  const startInit = Date.now();
  await adapter.initialize();
  console.log(`   ✅ Initialized in ${Date.now() - startInit}ms`);

  // Test 2: List root directory
  console.log("\n2️⃣  Listing root directory...");
  const rootEntries = await adapter.readdir("");
  console.log(`   ✅ Found ${rootEntries.length} entries:`);
  for (const entry of rootEntries.slice(0, 10)) {
    const icon = entry.isDirectory ? "📁" : "📄";
    console.log(`      ${icon} ${entry.name}`);
  }
  if (rootEntries.length > 10) {
    console.log(`      ... and ${rootEntries.length - 10} more`);
  }

  // Test 3: Check if common files exist
  console.log("\n3️⃣  Checking common files...");
  const filesToCheck = ["package.json", "README.md", "veryfront.config.ts", "tsconfig.json"];
  for (const file of filesToCheck) {
    const exists = await adapter.exists(file);
    console.log(`   ${exists ? "✅" : "❌"} ${file}`);
  }

  // Test 4: Read a file
  console.log("\n4️⃣  Reading package.json...");
  if (await adapter.exists("package.json")) {
    const content = await adapter.readTextFile("package.json");
    const pkg = JSON.parse(content);
    console.log(`   ✅ Project: ${pkg.name || "unnamed"}`);
    console.log(`   ✅ Content length: ${content.length} bytes`);
  } else {
    console.log("   ⏭️  Skipped (file doesn't exist)");
  }

  // Test 5: File resolution
  console.log("\n5️⃣  Testing file resolution...");
  const pathsToResolve = ["pages/index", "app/page", "src/index"];
  for (const path of pathsToResolve) {
    const resolved = await adapter.resolveFile(path);
    if (resolved) {
      console.log(`   ✅ ${path} → ${resolved}`);
    } else {
      console.log(`   ➖ ${path} → not found`);
    }
  }

  // Test 6: Stat a file
  console.log("\n6️⃣  Getting file stats...");
  const firstFile = rootEntries.find(e => e.isFile);
  if (firstFile) {
    const stat = await adapter.stat(firstFile.path);
    console.log(`   ✅ ${firstFile.name}: ${stat.size} bytes, isFile=${stat.isFile}`);
  }

  // Test 7: Cache stats
  console.log("\n7️⃣  Cache statistics:");
  const cacheStats = adapter.getCacheStats();
  console.log(`   📊 Entries: ${cacheStats.cache.size}`);
  console.log(`   📊 Memory: ${(cacheStats.cache.memoryUsed / 1024).toFixed(1)} KB`);
  console.log(`   📊 Hit rate: ${(cacheStats.cache.hitRate * 100).toFixed(1)}%`);

  // Test 8: Rate limit info
  console.log("\n8️⃣  Rate limit status:");
  const rateLimit = adapter.getRateLimitInfo();
  if (rateLimit) {
    console.log(`   📊 Remaining: ${rateLimit.remaining}/${rateLimit.limit}`);
    console.log(`   📊 Resets: ${rateLimit.reset.toLocaleTimeString()}`);
  } else {
    console.log("   ➖ No rate limit info yet");
  }

  console.log("\n✅ All tests passed!\n");

} catch (error) {
  console.error("\n❌ Test failed:", error);
  Deno.exit(1);
}
