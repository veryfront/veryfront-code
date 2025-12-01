import { join, relative } from "std/path/mod.ts";
import { serverLogger } from "@veryfront/utils";
import { toBase64Url } from "@veryfront/utils/path-utils.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import type { ComponentAnalysis, ComponentType } from "./types.ts";
import type { FileSystemAdapter } from "../../platform/adapters/base.ts";

export async function analyzeComponent(
  filePath: string,
  fs: FileSystemAdapter,
): Promise<ComponentAnalysis> {
  const content = await fs.readFile(filePath);

  const hasUseClient = detectDirective(content, "use client");
  const hasUseServer = detectDirective(content, "use server");

  let type: ComponentType = "server";

  if (hasUseClient) {
    type = "client";
  } else if (hasUseServer) {
    type = "server";
  } else if (filePath.includes(".client.")) {
    // File naming convention
    type = "client";
  } else if (filePath.includes(".server.")) {
    type = "server";
  }

  const exports = extractExports(content);
  const id = generateComponentId(filePath);

  return {
    type,
    filePath,
    exports,
    id,
    hasUseClient,
    hasUseServer,
  };
}

function detectDirective(content: string, directive: string): boolean {
  // Match directives like 'use client' or "use client" at the start of a line
  const directivePattern = new RegExp(`^\\s*['"]${directive}['"];?\\s*$`, "m");

  return directivePattern.test(content);
}

function extractExports(content: string): string[] {
  const exports: string[] = [];

  if (/export\s+default\s+/m.test(content)) {
    exports.push("default");
  }

  const namedExportPattern = /export\s+(?:const|let|var|function|class)\s+(\w+)/gm;
  let match;

  while ((match = namedExportPattern.exec(content)) !== null) {
    if (match[1]) {
      exports.push(match[1]);
    }
  }

  const exportBracesPattern = /export\s*\{([^}]+)\}/gm;

  while ((match = exportBracesPattern.exec(content)) !== null) {
    if (match[1]) {
      const names = match[1]
        .split(",")
        .map((name) => {
          const parts = name.trim().split(/\s+as\s+/);
          return parts[parts.length - 1]?.trim() || "";
        })
        .filter((name) => name.length > 0);
      exports.push(...names);
    }
  }

  return [...new Set(exports)];
}

function generateComponentId(filePath: string): string {
  let id = filePath.replace(/\.(tsx?|jsx?)$/, "").replace(/\.(client|server)$/, "");

  const parts = id.split("/");
  const fileName = parts[parts.length - 1];

  if (fileName === "index") {
    id = parts[parts.length - 2] || "Unknown";
  } else {
    id = fileName || "Unknown";
  }

  return toPascalCase(id);
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

export async function buildClientManifest(
  projectDir: string,
  appDir: string = "app",
  fs?: FileSystemAdapter,
): Promise<Map<string, import("./types.ts").ClientComponentMeta>> {
  const manifest = new Map<string, import("./types.ts").ClientComponentMeta>();
  const appPath = join(projectDir, appDir);

  // Get adapter if not provided
  let fsAdapter = fs;
  if (!fsAdapter) {
    try {
      const adapter = await getAdapter();
      fsAdapter = adapter.fs;
    } catch (error) {
      serverLogger.warn(`Failed to get file system adapter:`, error);
      return manifest;
    }
  }

  try {
    await walkDirectory(appPath, async (filePath) => {
      if (!/\.(tsx?|jsx?)$/.test(filePath)) return;

      const analysis = await analyzeComponent(filePath, fsAdapter!);

      if (analysis.type === "client") {
        const relativePath = relative(projectDir, filePath);

        manifest.set(analysis.id, {
          id: analysis.id,
          path: `/_veryfront/fs/${toBase64Url(filePath)}`,
          exports: analysis.exports,
        });

        serverLogger.debug(`Found client component: ${analysis.id} at ${relativePath}`);
      }
    }, fsAdapter);
  } catch (error) {
    serverLogger.warn(`Failed to build client manifest:`, error);
  }

  return manifest;
}

async function walkDirectory(
  dir: string,
  callback: (path: string) => Promise<void>,
  fs?: FileSystemAdapter,
): Promise<void> {
  try {
    if (!fs) {
      throw new Error("FileSystemAdapter is required for walkDirectory");
    }
    const entries = fs.readDir(dir);
    for await (const entry of entries) {
      const path = join(dir, entry.name);

      if (entry.isDirectory) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }
        await walkDirectory(path, callback, fs);
      } else if (entry.isFile) {
        await callback(path);
      }
    }
  } catch (error) {
    if ((error as { code?: string })?.code === "ENOENT") {
      return;
    }
    const message = String((error as Error)?.message || "").toLowerCase();
    if (message.includes("not found") || message.includes("no such file")) {
      return;
    }
    throw error;
  }
}
