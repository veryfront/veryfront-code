/**
 * Generates a JSON manifest of all CLI templates.
 *
 * This allows templates to be embedded in compiled binaries without
 * deno compile trying to analyze them as TypeScript modules.
 *
 * Usage:
 *   deno run -A scripts/build/generate-templates-manifest.ts
 *   deno run -A scripts/build/generate-templates-manifest.ts --check
 *   deno run -A scripts/build/generate-templates-manifest.ts --check --root <path>
 */

import { walk } from "#std/fs/walk";
import { relative } from "#std/path";
import { encodeBase64Bytes } from "../../src/utils/base64url.ts";

interface TemplateManifest {
  version: number;
  templates: Record<string, TemplateEntry>;
}

interface TemplateEntry {
  files: Record<string, string>; // path -> content
}

/**
 * File name mappings for npm publishing compatibility.
 * npm strips dotfiles during publish, so we use underscore prefixes in source.
 */
const FILE_NAME_MAPPINGS: Record<string, string> = {
  _gitignore: ".gitignore",
  _env: ".env",
  "_env.example": ".env.example",
  "_env.auth.example": ".env.auth.example",
  _npmrc: ".npmrc",
  "_eslintrc.json": ".eslintrc.json",
  _prettierrc: ".prettierrc",
};
const AUTH_PRESET_DIRS = ["authelia", "microsoft-entra", "oidc"] as const;
const AUTH_PRESET_DIR_SET = new Set<string>(AUTH_PRESET_DIRS);

function mapFileName(path: string): string {
  const parts = path.split("/");
  const fileName = parts[parts.length - 1] ?? "";
  const mapped = FILE_NAME_MAPPINGS[fileName];
  if (mapped) {
    parts[parts.length - 1] = mapped;
    return parts.join("/");
  }
  return path;
}

async function collectSortedDirectoryEntries(
  path: string,
): Promise<Deno.DirEntry[]> {
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(path)) {
    entries.push(entry);
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

async function collectSortedFiles(
  root: string,
): Promise<Array<{ path: string }>> {
  const files: Array<{ path: string }> = [];
  for await (
    const file of walk(root, {
      includeDirs: false,
      skip: [/[\/\\](?:\.cache|node_modules)[\/\\]?/, /CLAUDE\.md$/],
    })
  ) {
    files.push(file);
  }
  return files.sort((a, b) =>
    relative(root, a.path).localeCompare(relative(root, b.path))
  );
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function generateManifest(): Promise<TemplateManifest> {
  const templatesDir = "./templates/files";
  const integrationsDir = "./templates/integrations";
  const authDir = "./templates/auth";
  const manifest: TemplateManifest = {
    version: 1,
    templates: {},
  };

  // Process main templates (minimal, app, blog, etc.)
  for (const entry of await collectSortedDirectoryEntries(templatesDir)) {
    if (!entry.isDirectory) continue;

    const templateName = entry.name;
    const templatePath = `${templatesDir}/${templateName}`;
    const files: Record<string, string> = {};

    for (const file of await collectSortedFiles(templatePath)) {
      const relativePath = relative(templatePath, file.path);
      const mappedPath = mapFileName(relativePath);
      const content = await Deno.readTextFile(file.path);
      files[mappedPath] = content;
    }

    manifest.templates[templateName] = { files };
  }

  // Process integration templates
  for (const entry of await collectSortedDirectoryEntries(integrationsDir)) {
    if (!entry.isDirectory) continue;

    const integrationName = entry.name;
    const integrationPath = `${integrationsDir}/${integrationName}/files`;

    try {
      const stat = await Deno.stat(integrationPath);
      if (!stat.isDirectory) continue;
    } catch {
      continue; // No files directory
    }

    const files: Record<string, string> = {};

    for (const file of await collectSortedFiles(integrationPath)) {
      const relativePath = relative(integrationPath, file.path);
      const mappedPath = mapFileName(relativePath);
      const content = await Deno.readTextFile(file.path);
      files[mappedPath] = content;
    }

    if (Object.keys(files).length === 0) continue;

    manifest.templates[`integration:${integrationName}`] = { files };
  }

  // Process auth templates. Each preset layers the shared base files first,
  // then provider-specific files in sorted path order.
  if (await directoryExists(authDir)) {
    const baseAuthPath = `${authDir}/_base/files`;
    if (!(await directoryExists(baseAuthPath))) {
      throw new Error(
        "Required auth base template directory is missing: templates/auth/_base/files",
      );
    }
    const baseAuthFiles: Record<string, string> = {};
    for (const file of await collectSortedFiles(baseAuthPath)) {
      const relativePath = relative(baseAuthPath, file.path);
      const mappedPath = mapFileName(relativePath);
      baseAuthFiles[mappedPath] = await Deno.readTextFile(file.path);
    }

    for (const entry of await collectSortedDirectoryEntries(authDir)) {
      if (!entry.isDirectory || entry.name === "_base") continue;
      if (!AUTH_PRESET_DIR_SET.has(entry.name)) {
        throw new Error(
          `Unknown auth preset directory: templates/auth/${entry.name}`,
        );
      }

      const presetName = entry.name;
      const presetPath = `${authDir}/${presetName}/files`;

      if (!(await directoryExists(presetPath))) {
        throw new Error(
          `Required auth preset files directory is missing: templates/auth/${presetName}/files`,
        );
      }

      const files: Record<string, string> = { ...baseAuthFiles };
      for (const file of await collectSortedFiles(presetPath)) {
        const relativePath = relative(presetPath, file.path);
        const mappedPath = mapFileName(relativePath);
        if (Object.hasOwn(baseAuthFiles, mappedPath)) {
          throw new Error(
            `Auth provider file overrides base file: templates/auth/${presetName}/files/${relativePath}`,
          );
        }
        files[mappedPath] = await Deno.readTextFile(file.path);
      }

      if (Object.keys(files).length === 0) continue;
      manifest.templates[`auth:${presetName}`] = { files };
    }
  }

  // Process ai-rules templates (used by `veryfront install`)
  const aiRulesDir = "./templates/ai-rules";
  for (const entry of await collectSortedDirectoryEntries(aiRulesDir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const content = await Deno.readTextFile(`${aiRulesDir}/${entry.name}`);
    manifest.templates[`ai-rules:${entry.name}`] = {
      files: { [entry.name]: content },
    };
  }

  return manifest;
}

function getRootArgument(args: string[]): string | undefined {
  const rootIndex = args.indexOf("--root");
  if (rootIndex === -1) return undefined;

  const root = args[rootIndex + 1];
  if (root === undefined || root.startsWith("--")) {
    throw new Error("--root requires a directory path");
  }
  return root;
}

async function decompressGeneratedManifest(
  source: string | null,
): Promise<string | null> {
  const encoded = source?.match(
    /COMPRESSED_TEMPLATE_MANIFEST_BASE64:\s*string\s*=\s*"([A-Za-z0-9+/=]+)";/,
  )?.[1];
  if (encoded === undefined) return null;

  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    const stream = new Blob([bytes]).stream().pipeThrough(
      new DecompressionStream("gzip"),
    );
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

/**
 * Write (or verify) the generated manifest artifacts.
 *
 * Guarded by `import.meta.main` so importing this module has no side effects.
 * Without it, merely importing to reach a helper regenerated and REWROTE both
 * tracked artifacts. The gzip representation varies with the installed
 * Deno version, so a test run could leave a spurious diff in the working tree.
 * `run-generate.ts` invokes this as a subprocess, so the guard is true there.
 */
async function main(): Promise<void> {
  const root = getRootArgument(Deno.args);
  if (root !== undefined) Deno.chdir(root);

  const manifest = await generateManifest();
  const outputPath = "./templates/manifest.json";
  const output = JSON.stringify(manifest, null, 2) + "\n";
  const compressedStream = new Blob([output]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  const compressedBytes = new Uint8Array(
    await new Response(compressedStream).arrayBuffer(),
  );
  const compressedOutputPath = "./templates/manifest.generated.ts";
  // Joined rather than written as a multi-line template literal: the literal
  // preserves its source indentation verbatim, so indenting this block once
  // leaked a tab into every line of the GENERATED file and `ci (format)`
  // rejected it. Building the lines explicitly makes the output independent of
  // how this function happens to be nested.
  const compressedOutput = [
    "/** Generated by scripts/build/generate-templates-manifest.ts. */",
    "export const COMPRESSED_TEMPLATE_MANIFEST_BASE64: string =",
    `  "${encodeBase64Bytes(compressedBytes)}";`,
    "",
  ].join("\n");

  const templateCount = Object.keys(manifest.templates).length;
  const fileCount = Object.values(manifest.templates).reduce(
    (sum, t) => sum + Object.keys(t.files).length,
    0,
  );

  if (Deno.args.includes("--check")) {
    const existing = await Deno.readTextFile(outputPath).catch(() => null);
    const existingCompressedSource = await Deno.readTextFile(
      compressedOutputPath,
    ).catch(() => null);
    const existingCompressed = await decompressGeneratedManifest(
      existingCompressedSource,
    );
    const stalePaths = [
      ...(existing !== output ? [outputPath] : []),
      ...(existingCompressed !== output ? [compressedOutputPath] : []),
    ];
    if (stalePaths.length > 0) {
      console.error(
        `${stalePaths.join(", ")} is stale. Run deno task generate.`,
      );
      Deno.exit(1);
    }

    console.log(`${outputPath} and ${compressedOutputPath} are current.`);
    console.log(`   ${templateCount} templates, ${fileCount} files`);
  } else {
    await Deno.writeTextFile(outputPath, output);
    await Deno.writeTextFile(compressedOutputPath, compressedOutput);
    console.log(`✅ Generated ${outputPath} and ${compressedOutputPath}`);
    console.log(`   ${templateCount} templates, ${fileCount} files`);
  }
}

if (import.meta.main) await main();
