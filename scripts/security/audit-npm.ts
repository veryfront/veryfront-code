/**
 * NPM dependency audit script for Deno projects.
 *
 * Extracts npm dependencies from deno.json, runs npm audit against them,
 * and reports vulnerabilities. Exits with code 1 if high/critical vulns found.
 *
 * Usage: deno run --allow-read --allow-run --allow-write scripts/security/audit-npm.ts
 */

import { normalizeNpmPackageMetadata } from "../build/npm-package-metadata.ts";

const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
const imports: Record<string, string> = denoConfig.imports ?? {};

// Extract npm package names and versions
const npmDeps: Record<string, string> = {};
for (const [_specifier, target] of Object.entries(imports)) {
  if (!target.startsWith("npm:")) continue;
  const match = target.match(/^npm:(.+)@(\d[^/]*)/);
  if (!match) continue;
  const [, name, version] = match;
  npmDeps[name] = version;
}

if (Object.keys(npmDeps).length === 0) {
  console.log("No npm dependencies found in deno.json.");
  Deno.exit(0);
}

// Create a temporary package.json for npm audit
const tmpDir = await Deno.makeTempDir({ prefix: "vf-audit-" });
const packageJson = normalizeNpmPackageMetadata({
  name: "veryfront-audit",
  version: "0.0.0",
  private: true,
  dependencies: npmDeps,
});

await Deno.writeTextFile(
  `${tmpDir}/package.json`,
  JSON.stringify(packageJson, null, 2),
);

console.log(`Auditing ${Object.keys(npmDeps).length} npm dependencies...\n`);

// Run npm audit --json
const cmd = new Deno.Command("npm", {
  args: ["audit", "--json", "--omit=dev", "--package-lock-only"],
  cwd: tmpDir,
  stdout: "piped",
  stderr: "piped",
});

// First generate package-lock.json
const installCmd = new Deno.Command("npm", {
  args: ["install", "--package-lock-only", "--ignore-scripts"],
  cwd: tmpDir,
  stdout: "piped",
  stderr: "piped",
});

const installResult = await installCmd.output();
if (!installResult.success) {
  const stderr = new TextDecoder().decode(installResult.stderr);
  console.error("Failed to generate package-lock.json:", stderr);
  await Deno.remove(tmpDir, { recursive: true });
  Deno.exit(1);
}

const result = await cmd.output();
const stdout = new TextDecoder().decode(result.stdout);

// Clean up
await Deno.remove(tmpDir, { recursive: true });

// Parse audit results
let audit: {
  vulnerabilities?: Record<
    string,
    { severity: string; via: unknown[]; fixAvailable?: boolean }
  >;
  metadata?: {
    vulnerabilities: Record<string, number>;
    totalDependencies: number;
  };
};

try {
  audit = JSON.parse(stdout);
} catch {
  // Fail closed: non-JSON output means npm audit errored (network, auth, registry)
  console.error("❌ npm audit failed — non-JSON output (possible network/registry error).");
  console.error("stdout:", stdout.slice(0, 500));
  Deno.exit(1);
}

const meta = audit.metadata?.vulnerabilities;
const vulns = audit.vulnerabilities ?? {};

if (!meta || Object.values(meta).every((v) => v === 0)) {
  console.log("✅ No vulnerabilities found.");
  Deno.exit(0);
}

// Report
console.log("Vulnerability Summary:");
console.log(`  Critical: ${meta.critical ?? 0}`);
console.log(`  High:     ${meta.high ?? 0}`);
console.log(`  Moderate: ${meta.moderate ?? 0}`);
console.log(`  Low:      ${meta.low ?? 0}`);
console.log(`  Info:     ${meta.info ?? 0}`);
console.log(`  Total:    ${meta.total ?? 0}`);
console.log();

// List affected packages
const sevOrder = ["critical", "high", "moderate", "low", "info"];
const sortedVulns = Object.entries(vulns).sort(
  ([, a], [, b]) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity),
);

for (const [pkg, info] of sortedVulns) {
  const fix = info.fixAvailable ? " (fix available)" : "";
  console.log(`  ${info.severity.toUpperCase().padEnd(10)} ${pkg}${fix}`);
}

// Exit with error if high or critical vulnerabilities found
const hasBlocking = (meta.critical ?? 0) > 0 || (meta.high ?? 0) > 0;
if (hasBlocking) {
  console.log("\n❌ High/critical vulnerabilities found. Audit failed.");
  Deno.exit(1);
} else {
  console.log("\n⚠️  Non-blocking vulnerabilities found (moderate/low/info only).");
  Deno.exit(0);
}
