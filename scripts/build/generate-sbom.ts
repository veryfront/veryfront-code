/**
 * Generate a CycloneDX 1.5 SBOM from deno.lock.
 *
 * Usage: deno run --allow-read --allow-write scripts/build/generate-sbom.ts [--output path]
 *
 * Walks deno.lock so the SBOM lists the transitive npm graph that ships in
 * the binary, not just the top-level import map.
 */

import { parseArgs } from "#std/flags";

export interface CycloneDXComponent {
  type: "library";
  name: string;
  version: string;
  purl: string;
  hashes?: Array<{ alg: string; content: string }>;
}

/**
 * Lockfile versions whose schema this parser has been validated against.
 * Bump (and re-test) when Deno introduces a new lock format.
 */
export const SUPPORTED_LOCK_VERSIONS = ["5"] as const;

interface DenoLockV5 {
  version: string;
  specifiers?: Record<string, string>;
  npm?: Record<string, { integrity?: string; dependencies?: string[] }>;
  jsr?: Record<string, unknown>;
}

function parseNameVersion(key: string): { name: string; version: string } | null {
  let scope = "";
  let rest = key;
  if (key.startsWith("@")) {
    const slash = key.indexOf("/");
    if (slash < 0) return null;
    scope = key.slice(0, slash + 1);
    rest = key.slice(slash + 1);
  }
  const at = rest.indexOf("@");
  if (at <= 0) return null;
  const name = scope + rest.slice(0, at);
  let version = rest.slice(at + 1);
  const underscore = version.indexOf("_");
  if (underscore >= 0) version = version.slice(0, underscore);
  return { name, version };
}

function purlFor(name: string, version: string): string {
  const encoded = name.split("/").map(encodeURIComponent).join("/");
  return `pkg:npm/${encoded}@${version}`;
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
  const lock = JSON.parse(lockText) as DenoLockV5;
  if (
    !SUPPORTED_LOCK_VERSIONS.includes(
      lock.version as typeof SUPPORTED_LOCK_VERSIONS[number],
    )
  ) {
    throw new Error(
      `Unsupported deno.lock version: "${lock.version}" (supported: ${
        SUPPORTED_LOCK_VERSIONS.join(", ")
      })`,
    );
  }
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
      purl: purlFor(nv.name, nv.version),
      ...(hash ? { hashes: [hash] } : {}),
    });
  }
  return components;
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["output"],
    default: { output: "dist/sbom.json" },
  });

  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const lockText = await Deno.readTextFile("deno.lock");
  const components = componentsFromLock(lockText);

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
        name: denoConfig.name ?? "veryfront",
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
