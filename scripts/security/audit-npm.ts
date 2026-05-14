/**
 * NPM dependency audit script for Deno projects.
 *
 * Extracts npm dependencies from deno.json, runs npm audit against them,
 * and reports vulnerabilities. Exits with code 1 if high/critical vulns found.
 *
 * Usage: deno run --allow-read --allow-run --allow-write scripts/security/audit-npm.ts
 */

export interface AuditPackageJson {
  name: string;
  version: string;
  private: boolean;
  dependencies: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export interface ImportMapManifest {
  sourceLocation: string;
  imports: Record<string, string>;
}

export function collectNpmDependencies(
  manifests: ImportMapManifest[],
): Record<string, string> {
  const versionsByName = new Map<string, Set<string>>();

  for (const manifest of manifests) {
    for (const [_specifier, target] of Object.entries(manifest.imports)) {
      if (!target.startsWith("npm:")) continue;
      const match = target.match(/^npm:(.+)@(\d[^/]*)/);
      if (!match) continue;
      const [, name, version] = match;
      const versions = versionsByName.get(name) ?? new Set<string>();
      versions.add(version);
      versionsByName.set(name, versions);
    }
  }

  const npmDeps: Record<string, string> = {};
  for (
    const [name, versions] of [...versionsByName].sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ) {
    const sortedVersions = [...versions].sort();
    const [primaryVersion, ...additionalVersions] = sortedVersions;
    npmDeps[name] = primaryVersion;
    for (const version of additionalVersions) {
      npmDeps[auditAliasName(name, version)] = `npm:${name}@${version}`;
    }
  }

  return Object.fromEntries(
    Object.entries(npmDeps).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
  );
}

function auditAliasName(name: string, version: string): string {
  return `vf-audit-${
    `${name}-${version}`
      .toLowerCase()
      .replace(/^@/, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }`;
}

export function buildAuditPackageJson(
  dependencies: Record<string, string>,
): AuditPackageJson {
  return {
    name: "veryfront-audit",
    version: "0.0.0",
    private: true,
    dependencies,
  };
}

function normalizeWorkspaceMemberPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

async function readImportMapManifests(): Promise<ImportMapManifest[]> {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const manifests: ImportMapManifest[] = [{
    sourceLocation: "deno.json",
    imports: denoConfig.imports ?? {},
  }];

  if (Array.isArray(denoConfig.workspace)) {
    for (const entry of denoConfig.workspace) {
      if (typeof entry !== "string") continue;
      const memberPath = normalizeWorkspaceMemberPath(entry);
      if (!memberPath) continue;
      const sourceLocation = `${memberPath}/deno.json`;
      const memberConfig = JSON.parse(await Deno.readTextFile(sourceLocation));
      manifests.push({
        sourceLocation,
        imports: memberConfig.imports ?? {},
      });
    }
  }

  return manifests;
}

if (import.meta.main) {
  const npmDeps = collectNpmDependencies(await readImportMapManifests());

  if (Object.keys(npmDeps).length === 0) {
    console.log("No npm dependencies found in workspace manifests.");
    Deno.exit(0);
  }

  // Create a temporary package.json for npm audit
  const tmpDir = await Deno.makeTempDir({ prefix: "vf-audit-" });
  const packageJson = buildAuditPackageJson(npmDeps);

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
    console.error(
      "❌ npm audit failed — non-JSON output (possible network/registry error).",
    );
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
    ([, a], [, b]) =>
      sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity),
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
    console.log(
      "\n⚠️  Non-blocking vulnerabilities found (moderate/low/info only).",
    );
    Deno.exit(0);
  }
}
