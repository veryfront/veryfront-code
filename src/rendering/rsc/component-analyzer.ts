import { join, relative } from "#veryfront/compat/path/index.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { serverLogger } from "#veryfront/utils";
import { capitalizeSeparatedWords } from "#veryfront/utils/case-utils.ts";
import { toBase64Url } from "#veryfront/utils/path-utils.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import type { ClientComponentMeta, ComponentAnalysis, ComponentType } from "./types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { extractExportNames } from "./export-extractor.ts";

export async function analyzeComponent(
  filePath: string,
  fs: FileSystemAdapter,
): Promise<ComponentAnalysis> {
  const content = await fs.readFile(filePath);

  const hasUseClient = detectDirective(content, "use client");
  const hasUseServer = detectDirective(content, "use server");

  // Determine component type: directive takes precedence over file naming convention
  const type: ComponentType = hasUseClient || filePath.includes(".client.") ? "client" : "server";

  return {
    type,
    filePath,
    exports: extractExportNames(content),
    id: generateComponentId(filePath),
    hasUseClient,
    hasUseServer,
  };
}

function detectDirective(content: string, directive: string): boolean {
  const directivePattern = new RegExp(`^\\s*['"]${directive}['"];?\\s*$`, "m");
  return directivePattern.test(content);
}

function generateComponentId(filePath: string): string {
  const normalized = filePath.replace(/\.(tsx?|jsx?)$/, "").replace(/\.(client|server)$/, "");
  const parts = normalized.split("/");
  const fileName = parts.at(-1);

  if (fileName === "index") {
    return toPascalCase(parts.at(-2) ?? "Unknown");
  }

  return toPascalCase(fileName ?? "Unknown");
}

function toPascalCase(str: string): string {
  return capitalizeSeparatedWords(str, /[-_\s]+/, "");
}

export async function buildClientManifest(
  projectDir: string,
  appDir: string = "app",
  fs?: FileSystemAdapter,
): Promise<Map<string, ClientComponentMeta>> {
  const manifest = new Map<string, ClientComponentMeta>();
  const appPath = join(projectDir, appDir);

  const fsAdapter = fs ?? (await getFsAdapter());
  if (!fsAdapter) return manifest;

  try {
    await walkDirectory(
      appPath,
      async (filePath) => {
        if (!/\.(tsx?|jsx?)$/.test(filePath)) return;

        const analysis = await analyzeComponent(filePath, fsAdapter);
        if (analysis.type !== "client") return;

        const relativePath = relative(projectDir, filePath);

        manifest.set(analysis.id, {
          id: analysis.id,
          path: `/_veryfront/fs/${toBase64Url(filePath)}`,
          exports: analysis.exports,
        });

        serverLogger.debug(`Found client component: ${analysis.id} at ${relativePath}`);
      },
      fsAdapter,
    );
  } catch (error) {
    serverLogger.warn(`Failed to build client manifest:`, error);
  }

  return manifest;
}

async function getFsAdapter(): Promise<FileSystemAdapter | undefined> {
  try {
    const adapter = await runtime.get();
    return adapter.fs;
  } catch (error) {
    serverLogger.warn(`Failed to get file system adapter:`, error);
    return undefined;
  }
}

async function walkDirectory(
  dir: string,
  callback: (path: string) => Promise<void>,
  fs?: FileSystemAdapter,
): Promise<void> {
  try {
    if (!fs) {
      throw toError(
        createError({
          type: "config",
          message: "FileSystemAdapter is required for walkDirectory",
        }),
      );
    }

    const entries = fs.readDir(dir);

    for await (const entry of entries) {
      const path = join(dir, entry.name);

      if (entry.isDirectory) {
        if (shouldSkipDirectory(dir, entry.name)) continue;
        await walkDirectory(path, callback, fs);
        continue;
      }

      if (entry.isFile) {
        await callback(path);
      }
    }
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

function shouldSkipDirectory(parentDir: string, name: string): boolean {
  // Skip node_modules and hidden dirs, but allow .veryfront (excluding system subdirs)
  if (name === "node_modules") return true;
  if (name.startsWith(".") && name !== ".veryfront") return true;

  if (!parentDir.includes(".veryfront")) return false;

  return ["cache", "compiled", "tmp", "temp", "output", "optimized-images", "css"].includes(name);
}
