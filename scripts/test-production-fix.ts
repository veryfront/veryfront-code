#!/usr/bin/env -S deno run --allow-all
/**
 * Test production fixes locally against production API
 *
 * Usage:
 *   deno run --allow-all scripts/test-production-fix.ts <project-slug>
 *   deno run --allow-all scripts/test-production-fix.ts <project-slug> --compiled
 *
 * This script:
 * 1. Starts the renderer (source or compiled)
 * 2. Makes requests to the project
 * 3. Checks for specific errors
 * 4. Reports results
 */

const PROJECT_SLUG = Deno.args[0];
if (!PROJECT_SLUG) {
  console.error("Error: project slug is required");
  console.error("Usage: deno run --allow-all scripts/test-production-fix.ts <project-slug> [--compiled]");
  Deno.exit(1);
}
const USE_COMPILED = Deno.args.includes("--compiled");
const PORT = 8080;

console.log(`\n🧪 Testing fix for: ${PROJECT_SLUG}`);
console.log(`   Mode: ${USE_COMPILED ? "compiled binary" : "source (deno task)"}`);
console.log(`   API: https://api.veryfront.com\n`);

// Start server
const env = {
  ...Deno.env.toObject(),
  VERYFRONT_API_BASE_URL: "https://api.veryfront.com",
  PROXY_MODE: "1",
};

let serverProcess: Deno.ChildProcess;

if (USE_COMPILED) {
  // Check if binary exists
  try {
    await Deno.stat("./veryfront-local");
  } catch {
    console.log("❌ Binary not found. Compile first:");
    console.log("   deno compile --allow-all --unstable-net --output ./veryfront-local cli/main.ts");
    Deno.exit(1);
  }

  console.log("🚀 Starting compiled binary...");
  const command = new Deno.Command("./veryfront-local", {
    args: ["dev", "-p", String(PORT)],
    env,
    stdout: "piped",
    stderr: "piped",
  });
  serverProcess = command.spawn();
} else {
  console.log("🚀 Starting source server (cli/main.ts dev)...");
  const command = new Deno.Command("deno", {
    args: ["run", "--allow-all", "--unstable-net", "cli/main.ts", "dev", "-p", String(PORT)],
    env,
    stdout: "piped",
    stderr: "piped",
  });
  serverProcess = command.spawn();
}

// Collect logs in background
const logs: string[] = [];
const collectLogs = async (stream: ReadableStream<Uint8Array>, prefix: string) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    logs.push(`[${prefix}] ${text}`);
  }
};

collectLogs(serverProcess.stdout, "stdout");
collectLogs(serverProcess.stderr, "stderr");

// Wait for server to be ready - just check that it responds
console.log("⏳ Waiting for server...");
const maxWait = 30_000;
const startTime = Date.now();

while (Date.now() - startTime < maxWait) {
  try {
    // Use project URL with Host header to get proper context
    const resp = await fetch(`http://localhost:${PORT}/`, {
      headers: { Host: `${PROJECT_SLUG}.lvh.me` },
    });
    // Any response means server is up
    console.log("✅ Server responding\n");
    break;
  } catch {
    // Not ready yet
  }
  await new Promise((r) => setTimeout(r, 1000));
}

if (Date.now() - startTime >= maxWait) {
  console.log("❌ Server failed to start within timeout");
  console.log("\nRecent logs:");
  console.log(logs.slice(-10).join(""));
  try { serverProcess.kill(); } catch { /* ignore */ }
  Deno.exit(1);
}

// Test the project
console.log(`📡 Testing http://${PROJECT_SLUG}.lvh.me:${PORT}/`);

try {
  const resp = await fetch(`http://${PROJECT_SLUG}.lvh.me:${PORT}/`, {
    headers: {
      Host: `${PROJECT_SLUG}.lvh.me`,
    },
  });

  const body = await resp.text();

  console.log(`   Status: ${resp.status}`);

  // Check for specific errors we're trying to fix
  const criticalErrors: string[] = [];
  const warnings: string[] = [];

  // Our specific fix targets
  if (body.includes("lib/utils") && body.includes("not found")) {
    criticalErrors.push("lib/utils not found error - FIX NEEDED");
  }
  if (body.includes("esm.sh/_vf_modules")) {
    criticalErrors.push("esm.sh /_vf_modules URL error - FIX NEEDED");
  }

  // Other errors
  if (body.includes("Module not found")) {
    const match = body.match(/Module not found[^<"]*/);
    const msg = match?.[0] || "Module not found";
    if (msg.includes("_vf_modules")) {
      criticalErrors.push(msg);
    } else {
      warnings.push(msg);
    }
  }

  // Expected in proxy mode without auth
  if (body.includes("Missing releaseId")) {
    console.log("\n⚠️  Expected: Missing releaseId (no proxy auth configured)");
    console.log("   This is expected when testing against production API without OAuth proxy.");
    console.log("   The important thing is no esm.sh/_vf_modules or lib/utils errors.");
  }

  // Check logs for our specific errors
  const moduleErrors = logs.filter(
    (l) =>
      l.includes("esm.sh/_vf_modules") ||
      (l.includes("lib/utils") && l.includes("not found"))
  );

  if (moduleErrors.length > 0) {
    console.log("\n❌ CRITICAL - Module resolution errors in logs:");
    moduleErrors.forEach((l) => console.log(l));
    criticalErrors.push("Module resolution errors found in logs");
  }

  if (criticalErrors.length > 0) {
    console.log("\n❌ CRITICAL ERRORS (fix needed):");
    criticalErrors.forEach((e) => console.log(`   - ${e}`));
  } else {
    console.log("\n✅ No critical errors (esm.sh/_vf_modules or lib/utils)");
    if (warnings.length > 0) {
      console.log("\n⚠️  Other warnings (may be expected):");
      warnings.forEach((w) => console.log(`   - ${w}`));
    }
  }

  // Show response preview
  if (body.length < 1000) {
    console.log("\n📄 Response preview:");
    console.log(body.slice(0, 500));
  }
} catch (error) {
  console.log(`\n❌ Request failed: ${error}`);
}

// Cleanup
console.log("\n🛑 Stopping server...");
try {
  serverProcess.kill();
} catch {
  // Already terminated
}
await serverProcess.status;
console.log("Done");
