/**
 * Generate a CycloneDX 1.5 SBOM from deno.lock.
 *
 * Usage: deno run --allow-read --allow-write scripts/build/generate-sbom.ts [--output path]
 *        deno run --allow-read --allow-write scripts/build/generate-sbom.ts \
 *          --manifest extensions/ext-sandbox-shell-tools/deno.json \
 *          --output dist/sbom-ext-sandbox-shell-tools.json
 *
 * Walks deno.lock so the SBOM lists the transitive npm graph that ships in
 * the binary, not just the top-level import map.
 */

import { parseArgs } from "#std/flags";
import {
  parseLock,
  parseNameVersion,
  purl,
  SUPPORTED_LOCK_VERSIONS,
} from "../lib/deno-lock.ts";
import { manifestsFromLock } from "../security/submit-dependency-snapshot.ts";

export { SUPPORTED_LOCK_VERSIONS };

export interface CycloneDXComponent {
  type: "library";
  name: string;
  version: string;
  purl: string;
  hashes?: Array<{ alg: string; content: string }>;
}

function hashFromIntegrity(
  integrity: string | undefined,
): { alg: string; content: string } | undefined {
  if (!integrity) return undefined;
  const m = integrity.match(/^sha(256|384|512)-(.+)$/);
  if (!m) return undefined;
  return { alg: `SHA-${m[1]}`, content: m[2] };
}

export function componentsFromLock(lockText: string): CycloneDXComponent[] {
  const lock = parseLock(lockText);
  const npm = lock.npm ?? {};
  const seen = new Set<string>();
  const components: CycloneDXComponent[] = [];
  for (const [key, info] of Object.entries(npm)) {
    const nv = parseNameVersion(key);
    if (!nv) continue;
    const canonical = `${nv.name}@${nv.version}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const hash = hashFromIntegrity(info.integrity);
    components.push({
      type: "library",
      name: nv.name,
      version: nv.version,
      purl: purl(nv.name, nv.version),
      ...(hash ? { hashes: [hash] } : {}),
    });
  }
  return components;
}

function parsePurlNameVersion(
  packageUrl: string,
): { name: string; version: string } | null {
  if (!packageUrl.startsWith("pkg:npm/")) return null;
  const rest = packageUrl.slice("pkg:npm/".length);
  const at = rest.lastIndexOf("@");
  if (at <= 0) return null;
  const name = rest.slice(0, at).split("/").map(decodeURIComponent).join("/");
  const version = rest.slice(at + 1);
  return { name, version };
}

export function componentsFromLockForManifest(
  lockText: string,
  manifestPath: string,
): CycloneDXComponent[] {
  const manifests = manifestsFromLock(lockText, {
    sha: "local",
    ref: "local",
    correlator: "local",
    runId: "local",
  });
  const manifest = manifests[manifestPath];
  if (!manifest) return [];

  const lock = parseLock(lockText);
  const npm = lock.npm ?? {};
  const components: CycloneDXComponent[] = [];
  for (const dependency of Object.values(manifest.resolved)) {
    const nv = parsePurlNameVersion(dependency.package_url);
    if (!nv) continue;
    const lockKey = Object.keys(npm).find((key) => {
      const parsed = parseNameVersion(key);
      return parsed?.name === nv.name && parsed.version === nv.version;
    });
    const hash = lockKey
      ? hashFromIntegrity(npm[lockKey]?.integrity)
      : undefined;
    components.push({
      type: "library",
      name: nv.name,
      version: nv.version,
      purl: dependency.package_url,
      ...(hash ? { hashes: [hash] } : {}),
    });
  }
  return components.sort((a, b) =>
    a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  );
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["manifest", "output"],
    default: { output: "dist/sbom.json" },
  });

  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const lockText = await Deno.readTextFile("deno.lock");
  const components = args.manifest
    ? componentsFromLockForManifest(lockText, args.manifest)
    : componentsFromLock(lockText);
  const componentName = args.manifest
    ? `${denoConfig.name ?? "veryfront"}:${args.manifest}`
    : denoConfig.name ?? "veryfront";

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        "bom-ref": "veryfront",
        type: "application",
        name: componentName,
        version: denoConfig.version ?? "0.0.0",
      },
      tools: [{ name: "generate-sbom", version: "1.1.0" }],
    },
    components: components.map((c) => ({
      "bom-ref": `${c.name}@${c.version}`,
      ...c,
    })),
    dependencies: [
      {
        ref: "veryfront",
        dependsOn: components.map((c) => `${c.name}@${c.version}`),
      },
    ],
  };

  const outputPath = args.output;
  const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  if (outputDir) {
    await Deno.mkdir(outputDir, { recursive: true });
  }
  await Deno.writeTextFile(outputPath, JSON.stringify(sbom, null, 2) + "\n");

  console.log(`✅ Generated SBOM: ${outputPath}`);
  console.log(`   ${components.length} components, CycloneDX 1.5 format`);
}
