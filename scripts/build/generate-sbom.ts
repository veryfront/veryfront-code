/**
 * Generate a CycloneDX 1.5 SBOM from deno.json imports.
 *
 * Usage: deno run --allow-read --allow-write scripts/build/generate-sbom.ts [--output path]
 *
 * Outputs CycloneDX 1.5 JSON to dist/sbom.json (or specified path).
 */

import { parseArgs } from "#std/flags";

const args = parseArgs(Deno.args, { string: ["output"], default: { output: "dist/sbom.json" } });

const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
const imports: Record<string, string> = denoConfig.imports ?? {};

interface CycloneDXComponent {
  type: string;
  name: string;
  version: string;
  purl?: string;
  scope?: string;
  properties?: Array<{ name: string; value: string }>;
}

function parseNpmSpecifier(target: string): { name: string; version: string } | null {
  const match = target.match(/^npm:(.+)@(\d[^/]*)/);
  if (!match) return null;
  return { name: match[1], version: match[2] };
}

function parseEsmShSpecifier(target: string): { name: string; version: string } | null {
  const match = target.match(/esm\.sh\/(.+?)@(\d[^/?]*)/);
  if (!match) return null;
  return { name: match[1], version: match[2] };
}

const seen = new Set<string>();
const components: CycloneDXComponent[] = [];

for (const [_specifier, target] of Object.entries(imports)) {
  // Skip local paths and jsr imports
  if (target.startsWith("./") || target.startsWith("../") || target.startsWith("jsr:")) continue;

  let parsed: { name: string; version: string } | null = null;

  if (target.startsWith("npm:")) {
    parsed = parseNpmSpecifier(target);
  } else if (target.startsWith("https://esm.sh/")) {
    parsed = parseEsmShSpecifier(target);
  }

  if (!parsed) continue;

  const key = `${parsed.name}@${parsed.version}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const component: CycloneDXComponent = {
    type: "library",
    name: parsed.name,
    version: parsed.version,
    purl: `pkg:npm/${parsed.name.split("/").map(encodeURIComponent).join("/")}@${parsed.version}`,
  };

  if (target.startsWith("https://esm.sh/")) {
    component.properties = [{ name: "cdnSource", value: "esm.sh" }];
  }

  components.push(component);
}

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      name: denoConfig.name ?? "veryfront",
      version: denoConfig.version ?? "0.0.0",
    },
    tools: [{ name: "generate-sbom", version: "1.0.0" }],
  },
  components,
};

const outputPath = args.output;
const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
if (outputDir) {
  await Deno.mkdir(outputDir, { recursive: true });
}
await Deno.writeTextFile(outputPath, JSON.stringify(sbom, null, 2) + "\n");

console.log(`✅ Generated SBOM: ${outputPath}`);
console.log(`   ${components.length} components, CycloneDX 1.5 format`);
