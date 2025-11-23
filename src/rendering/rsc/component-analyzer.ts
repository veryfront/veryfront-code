/**
 * Component analyzer for RSC
 * Detects whether components are server or client components
 */

import { join, relative } from "std/path/mod.ts";
import { serverLogger } from "@veryfront/utils";
import type { ComponentAnalysis, ComponentType } from "./types.ts";

/**
 * Analyze a component file to determine its type
 */
export async function analyzeComponent(filePath: string): Promise<ComponentAnalysis> {
  const content = await Deno.readTextFile(filePath);

  // Check for directives
  const hasUseClient = detectDirective(content, "use client");
  const hasUseServer = detectDirective(content, "use server");

  // Determine component type
  let type: ComponentType = "server"; // Default to server component

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

  // Extract exports
  const exports = extractExports(content);

  // Generate component ID
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

/**
 * Detect directive in file content
 */
function detectDirective(content: string, directive: string): boolean {
  // Check for directive at the beginning of the file
  const directivePattern = new RegExp(`^\\s*['"]s*${directive}s*['"];?\\s*$`, "m");

  return directivePattern.test(content);
}

/**
 * Extract exports from component file
 */
function extractExports(content: string): string[] {
  const exports: string[] = [];

  // Match export default
  if (/export\s+default\s+/m.test(content)) {
    exports.push("default");
  }

  // Match named exports
  const namedExportPattern = /export\s+(?:const|let|var|function|class)\s+(\w+)/gm;
  let match;

  while ((match = namedExportPattern.exec(content)) !== null) {
    if (match[1]) {
      exports.push(match[1]);
    }
  }

  // Match export { ... }
  const exportBracesPattern = /export\s*\{([^}]+)\}/gm;

  while ((match = exportBracesPattern.exec(content)) !== null) {
    if (match[1]) {
      const names = match[1]
        .split(",")
        .map((name) => {
          // Handle 'as' syntax
          const parts = name.trim().split(/\s+as\s+/);
          return parts[parts.length - 1]?.trim() || "";
        })
        .filter((name) => name.length > 0);
      exports.push(...names);
    }
  }

  return [...new Set(exports)]; // Remove duplicates
}

/**
 * Generate a stable component ID from file path
 */
function generateComponentId(filePath: string): string {
  // Remove common prefixes and extensions
  let id = filePath.replace(/\.(tsx?|jsx?)$/, "").replace(/\.(client|server)$/, "");

  // Convert path to component name
  const parts = id.split("/");
  const fileName = parts[parts.length - 1];

  // Handle index files
  if (fileName === "index") {
    // Use parent directory name
    id = parts[parts.length - 2] || "Unknown";
  } else {
    id = fileName || "Unknown";
  }

  // Convert to PascalCase
  return toPascalCase(id);
}

/**
 * Convert string to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Build a manifest of client components in a directory
 */
export async function buildClientManifest(
  projectDir: string,
  appDir: string = "app",
): Promise<Map<string, import("./types.ts").ClientComponentMeta>> {
  const manifest = new Map<string, import("./types.ts").ClientComponentMeta>();
  const appPath = join(projectDir, appDir);

  try {
    await walkDirectory(appPath, async (filePath) => {
      // Only process JS/TS files
      if (!/\.(tsx?|jsx?)$/.test(filePath)) return;

      const analysis = await analyzeComponent(filePath);

      if (analysis.type === "client") {
        const relativePath = relative(projectDir, filePath);

        manifest.set(analysis.id, {
          id: analysis.id,
          path: `/_veryfront/fs/${encodeURIComponent(filePath)}`,
          exports: analysis.exports,
        });

        serverLogger.debug(`Found client component: ${analysis.id} at ${relativePath}`);
      }
    });
  } catch (error) {
    serverLogger.warn(`Failed to build client manifest:`, error);
  }

  return manifest;
}

/**
 * Walk directory recursively
 */
async function walkDirectory(
  dir: string,
  callback: (path: string) => Promise<void>,
): Promise<void> {
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);

      if (entry.isDirectory) {
        // Skip node_modules and hidden directories
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }
        await walkDirectory(path, callback);
      } else if (entry.isFile) {
        await callback(path);
      }
    }
  } catch (error) {
    // Directory might not exist
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }
}
