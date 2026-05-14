/**
 * Generate a CycloneDX 1.5 SBOM from deno.lock.
 *
 * Usage: deno run --allow-read --allow-write scripts/build/generate-sbom.ts [--output path]
 *        deno run --allow-read --allow-write scripts/build/generate-sbom.ts \
 *          --all-manifests --output-dir dist/sbom
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
import {
  type ManifestGenerationOptions,
  manifestsFromLock,
} from "../security/submit-dependency-snapshot.ts";

export { SUPPORTED_LOCK_VERSIONS };

export interface CycloneDXComponent {
  type: "library";
  name: string;
  version: string;
  purl: string;
  hashes?: Array<{ alg: string; content: string }>;
}

export interface SbomOutput {
  path: string;
  componentName: string;
  components: CycloneDXComponent[];
}

export interface DependencyIndexManifest {
  sourceLocation: string;
  group: "core" | "cli" | "react" | "extension" | "workspace";
  componentCount: number;
  components: Array<{
    name: string;
    version: string;
    purl: string;
  }>;
}

export interface DependencyIndex {
  generatedBy: string;
  manifests: DependencyIndexManifest[];
}

export interface DependencyBoundaryInputs {
  reactImports?: Record<string, string>;
  manifestImportsByPath?: Record<string, Record<string, string>>;
}

const REACT_BOUNDARY_IMPORTS = new Set([
  "@types/react",
  "@types/react-dom",
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
]);

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
  return sortComponents(components);
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

function parseNpmPackageSpec(
  packageSpec: string,
): { name: string; version: string } | null {
  const versionIndex = packageSpec.lastIndexOf("@");
  if (versionIndex <= 0) return null;

  const name = packageSpec.slice(0, versionIndex);
  const version = packageSpec.slice(versionIndex + 1);
  if (!name || !version) return null;
  return { name, version };
}

function packageSpecFromEsmShPath(pathname: string): string | null {
  const segments = decodeURIComponent(pathname)
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean);
  if (segments.length === 0) return null;
  return segments[0].startsWith("@")
    ? `${segments[0]}/${segments[1] ?? ""}`
    : segments[0];
}

function parseEsmShNpmPackages(
  target: string,
): Array<{ name: string; version: string }> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return [];
  }

  if (url.protocol !== "https:" || url.hostname !== "esm.sh") return [];

  const packages: Array<{ name: string; version: string }> = [];
  const packageSpec = packageSpecFromEsmShPath(url.pathname);
  if (packageSpec) {
    const npmPackage = parseNpmPackageSpec(packageSpec);
    if (npmPackage) packages.push(npmPackage);
  }

  for (const depsValue of url.searchParams.getAll("deps")) {
    for (const depSpec of depsValue.split(",")) {
      const npmPackage = parseNpmPackageSpec(depSpec.trim());
      if (npmPackage) packages.push(npmPackage);
    }
  }

  return packages;
}

export function componentsFromEsmShImports(
  imports: Record<string, string> = {},
  options: { onlySpecifiers?: Set<string> } = {},
): CycloneDXComponent[] {
  const components = new Map<string, CycloneDXComponent>();

  for (const [specifier, target] of Object.entries(imports)) {
    if (options.onlySpecifiers && !options.onlySpecifiers.has(specifier)) {
      continue;
    }
    for (const npmPackage of parseEsmShNpmPackages(target)) {
      const key = `${npmPackage.name}@${npmPackage.version}`;
      if (components.has(key)) continue;
      components.set(key, {
        type: "library",
        name: npmPackage.name,
        version: npmPackage.version,
        purl: purl(npmPackage.name, npmPackage.version),
      });
    }
  }

  return sortComponents([...components.values()]);
}

export function componentsForManifestBoundary(
  lockText: string,
  manifestPath: string,
  inputs: DependencyBoundaryInputs = {},
): CycloneDXComponent[] {
  return dedupeComponents([
    ...componentsFromLockForManifest(lockText, manifestPath),
    ...componentsFromEsmShImports(
      inputs.manifestImportsByPath?.[manifestPath] ?? {},
    ),
  ]);
}

function componentsForReactBoundary(
  inputs: DependencyBoundaryInputs = {},
): CycloneDXComponent[] {
  return componentsFromEsmShImports(inputs.reactImports ?? {}, {
    onlySpecifiers: REACT_BOUNDARY_IMPORTS,
  });
}

function dedupeComponents(
  components: CycloneDXComponent[],
): CycloneDXComponent[] {
  const byPurl = new Map<string, CycloneDXComponent>();
  for (const component of components) {
    byPurl.set(component.purl, component);
  }
  return sortComponents([...byPurl.values()]);
}

function sortComponents(
  components: CycloneDXComponent[],
): CycloneDXComponent[] {
  return components.toSorted((a, b) =>
    a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  );
}

function normalizeWorkspaceMemberPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function workspaceMembersFromDenoConfig(
  config: { workspace?: unknown },
): string[] {
  if (!Array.isArray(config.workspace)) return [];
  return config.workspace
    .filter((entry): entry is string => typeof entry === "string")
    .map(normalizeWorkspaceMemberPath)
    .filter((entry) => entry.length > 0)
    .sort();
}

function outputFileNameForManifest(manifestPath: string): string {
  if (manifestPath === "deno.json") return "core.json";
  if (manifestPath === "cli/deno.json") return "cli.json";
  if (manifestPath === "react") return "react.json";
  const extensionMatch = manifestPath.match(
    /^extensions\/([^/]+)\/deno\.json$/,
  );
  if (extensionMatch) return `${extensionMatch[1]}.json`;
  return `${
    manifestPath.replace(/\/deno\.json$/, "").replaceAll("/", "-")
  }.json`;
}

function joinOutputPath(outputDir: string, fileName: string): string {
  return `${outputDir.replace(/\/+$/, "")}/${fileName}`;
}

export function sbomOutputsForAllManifests(
  lockText: string,
  options: ManifestGenerationOptions & DependencyBoundaryInputs & {
    outputDir: string;
  },
): SbomOutput[] {
  const manifests = manifestsFromLock(lockText, {
    sha: "local",
    ref: "local",
    correlator: "local",
    runId: "local",
  }, { workspaceMembers: options.workspaceMembers });

  const manifestPaths = Object.keys(manifests).sort((left, right) => {
    if (left === "deno.json") return -1;
    if (right === "deno.json") return 1;
    if (left === "cli/deno.json") return -1;
    if (right === "cli/deno.json") return 1;
    return left.localeCompare(right);
  });

  const reactComponents = componentsForReactBoundary(options);
  const boundaryOutputs = manifestPaths.map((manifestPath) => ({
    path: joinOutputPath(
      options.outputDir,
      outputFileNameForManifest(manifestPath),
    ),
    componentName: `veryfront:${manifestPath}`,
    components: componentsForManifestBoundary(lockText, manifestPath, options),
  }));
  const allComponents = dedupeComponents([
    ...componentsFromLock(lockText),
    ...reactComponents,
    ...boundaryOutputs.flatMap((output) => output.components),
  ]);

  const leadingOutputs = boundaryOutputs.filter((output) =>
    output.componentName === "veryfront:deno.json" ||
    output.componentName === "veryfront:cli/deno.json"
  );
  const remainingOutputs = boundaryOutputs.filter((output) =>
    output.componentName !== "veryfront:deno.json" &&
    output.componentName !== "veryfront:cli/deno.json"
  );

  return [
    {
      path: joinOutputPath(options.outputDir, "all.json"),
      componentName: "veryfront",
      components: allComponents,
    },
    ...leadingOutputs,
    {
      path: joinOutputPath(
        options.outputDir,
        outputFileNameForManifest("react"),
      ),
      componentName: "veryfront:react",
      components: reactComponents,
    },
    ...remainingOutputs,
  ];
}

function manifestGroup(
  manifestPath: string,
): DependencyIndexManifest["group"] {
  if (manifestPath === "deno.json") return "core";
  if (manifestPath === "cli/deno.json") return "cli";
  if (manifestPath === "react") return "react";
  if (manifestPath.startsWith("extensions/")) return "extension";
  return "workspace";
}

function manifestPathsFromLock(
  lockText: string,
  options: ManifestGenerationOptions = {},
): string[] {
  const manifests = manifestsFromLock(lockText, {
    sha: "local",
    ref: "local",
    correlator: "local",
    runId: "local",
  }, { workspaceMembers: options.workspaceMembers });

  return Object.keys(manifests).sort((left, right) => {
    if (left === "deno.json") return -1;
    if (right === "deno.json") return 1;
    if (left === "cli/deno.json") return -1;
    if (right === "cli/deno.json") return 1;
    return left.localeCompare(right);
  });
}

export function dependencyIndexForAllManifests(
  lockText: string,
  options: ManifestGenerationOptions & DependencyBoundaryInputs = {},
): DependencyIndex {
  const reactComponents = componentsForReactBoundary(options);
  const manifestEntries = manifestPathsFromLock(lockText, options).map(
    (manifestPath) => ({
      manifestPath,
      components: componentsForManifestBoundary(
        lockText,
        manifestPath,
        options,
      ),
    }),
  );
  const leadingEntries = manifestEntries.filter(({ manifestPath }) =>
    manifestPath === "deno.json" || manifestPath === "cli/deno.json"
  );
  const remainingEntries = manifestEntries.filter(({ manifestPath }) =>
    manifestPath !== "deno.json" && manifestPath !== "cli/deno.json"
  );
  const orderedEntries = [
    ...leadingEntries,
    { manifestPath: "react", components: reactComponents },
    ...remainingEntries,
  ];

  return {
    generatedBy: "generate-sbom",
    manifests: orderedEntries.map(({ manifestPath, components }) => {
      return {
        sourceLocation: manifestPath,
        group: manifestGroup(manifestPath),
        componentCount: components.length,
        components: components.map((component) => ({
          name: component.name,
          version: component.version,
          purl: component.purl,
        })),
      };
    }),
  };
}

async function importsByWorkspaceManifest(
  workspaceMembers: string[],
): Promise<Record<string, Record<string, string>>> {
  const importsByManifest: Record<string, Record<string, string>> = {};
  for (const workspaceMember of workspaceMembers) {
    const manifestPath = `${workspaceMember}/deno.json`;
    try {
      const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
      if (manifest.imports && typeof manifest.imports === "object") {
        importsByManifest[manifestPath] = manifest.imports;
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  return importsByManifest;
}

function buildSbom(
  denoConfig: { name?: string; version?: string },
  componentName: string,
  components: CycloneDXComponent[],
) {
  return {
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
      tools: [{ name: "generate-sbom", version: "1.2.0" }],
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
}

async function writeSbom(outputPath: string, sbom: unknown): Promise<void> {
  const outputDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  if (outputDir) {
    await Deno.mkdir(outputDir, { recursive: true });
  }
  await Deno.writeTextFile(outputPath, JSON.stringify(sbom, null, 2) + "\n");
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["all-manifests"],
    string: ["manifest", "output", "output-dir"],
    default: { output: "dist/sbom.json", "output-dir": "dist/sbom" },
  });

  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const lockText = await Deno.readTextFile("deno.lock");

  if (args["all-manifests"]) {
    const workspaceMembers = workspaceMembersFromDenoConfig(denoConfig);
    const manifestImportsByPath = await importsByWorkspaceManifest(
      workspaceMembers,
    );
    const outputs = sbomOutputsForAllManifests(lockText, {
      outputDir: args["output-dir"],
      workspaceMembers,
      reactImports: denoConfig.imports,
      manifestImportsByPath,
    });
    await writeSbom(
      joinOutputPath(args["output-dir"], "dependencies-by-manifest.json"),
      dependencyIndexForAllManifests(lockText, {
        workspaceMembers,
        reactImports: denoConfig.imports,
        manifestImportsByPath,
      }),
    );
    console.log(
      `✅ Generated dependency index: ${
        joinOutputPath(args["output-dir"], "dependencies-by-manifest.json")
      }`,
    );
    for (const output of outputs) {
      await writeSbom(
        output.path,
        buildSbom(denoConfig, output.componentName, output.components),
      );
      console.log(
        `✅ Generated SBOM: ${output.path}`,
      );
      console.log(
        `   ${output.components.length} components, CycloneDX 1.5 format`,
      );
    }
    Deno.exit(0);
  }

  const workspaceMembers = workspaceMembersFromDenoConfig(denoConfig);
  const manifestImportsByPath = args.manifest
    ? await importsByWorkspaceManifest(workspaceMembers)
    : {};
  const boundaryInputs = {
    reactImports: denoConfig.imports,
    manifestImportsByPath,
  };
  const components = args.manifest
    ? args.manifest === "react"
      ? componentsForReactBoundary(boundaryInputs)
      : componentsForManifestBoundary(lockText, args.manifest, boundaryInputs)
    : componentsFromLock(lockText);
  const componentName = args.manifest
    ? `${denoConfig.name ?? "veryfront"}:${args.manifest}`
    : denoConfig.name ?? "veryfront";
  const outputPath = args.output;
  await writeSbom(outputPath, buildSbom(denoConfig, componentName, components));

  console.log(`✅ Generated SBOM: ${outputPath}`);
  console.log(`   ${components.length} components, CycloneDX 1.5 format`);
}
