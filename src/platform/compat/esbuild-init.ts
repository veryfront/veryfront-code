/**
 * Early esbuild binary initialization for deno compile.
 * MUST be imported at CLI entry point BEFORE any esbuild imports.
 */

import { tmpdir } from "node:os";
import process from "node:process";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { isDenoCompiled } from "./runtime.ts";
import { ESBUILD_VERSION, getEsbuildBinaryName, getVFSBasePath } from "./esbuild-shared.ts";

function cleanupExtractedEsbuildBinary(targetPath: string, extractionDir: string): void {
  for (const path of [targetPath, extractionDir]) {
    try {
      Deno.removeSync(path);
    } catch (cleanupError) {
      if (cleanupError instanceof Deno.errors.NotFound) continue;
      serverLogger.warn("[esbuild] Failed to clean up extracted binary", {
        extractionDir,
        path,
        cleanupError,
      });
    }
  }
}

async function findEsbuildInVFS(): Promise<string | null> {
  const binaryName = getEsbuildBinaryName();
  const vfsBase = getVFSBasePath(new URL(import.meta.url).pathname, tmpdir());

  const possiblePaths = [
    `${vfsBase}/node_modules/${binaryName}/bin/esbuild`,
    `${vfsBase}/node_modules/.deno/${binaryName}@${ESBUILD_VERSION}/node_modules/${binaryName}/bin/esbuild`,
    `${vfsBase}/node_modules/.deno/esbuild@${ESBUILD_VERSION}/node_modules/${binaryName}/bin/esbuild`,
    `${vfsBase}/node_modules/esbuild/bin/esbuild`,
  ];

  for (const vfsPath of possiblePaths) {
    try {
      const stat = await Deno.stat(vfsPath);
      if (stat.isFile) return vfsPath;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }

  return null;
}

async function extractEsbuildBinary(): Promise<string | null> {
  const vfsPath = await findEsbuildInVFS();
  if (!vfsPath) return null;

  // A process-unique directory prevents an attacker on a shared host from
  // pre-creating a cache path or replacing the target with a symlink between
  // validation and write.
  const extractionDir = await Deno.makeTempDir({
    prefix: `veryfront-esbuild-${ESBUILD_VERSION}-`,
  });
  const targetPath = `${extractionDir}/esbuild`;

  try {
    await Deno.writeFile(targetPath, await Deno.readFile(vfsPath), {
      createNew: true,
      mode: 0o755,
    });
    serverLogger.info("[esbuild] Extracted binary from VFS", { targetPath });
    process.once("exit", () => cleanupExtractedEsbuildBinary(targetPath, extractionDir));
    return targetPath;
  } catch (error) {
    try {
      await Deno.remove(extractionDir, { recursive: true });
    } catch (cleanupError) {
      serverLogger.warn("[esbuild] Failed to clean up extraction directory", {
        extractionDir,
        cleanupError,
      });
    }
    throw error;
  }
}

/**
 * Load esbuild while the host environment is still the one on `process.env`.
 *
 * esbuild resolves its binary once, when its module first evaluates:
 * `var ESBUILD_BINARY_PATH = process.env.ESBUILD_BINARY_PATH || ...`. The
 * bundler adapter imports esbuild lazily, so in the hosted runtime that
 * evaluation happens on the first transform -- inside a project environment
 * scope, which serves the project's variables and not the host's. esbuild then
 * reads `undefined`, falls back to a binary a compiled build does not ship,
 * `spawn` returns undefined, and no service ever starts. Every transform in the
 * process fails from then on.
 *
 * Importing here binds the path at startup, outside any project scope, so the
 * scope keeps hiding the host environment from project code and esbuild still
 * finds its binary. Only the module is loaded: the service itself starts lazily
 * on the first transform.
 */
async function primeEsbuildModule(): Promise<void> {
  try {
    await import("npm:esbuild@0.28.1");
  } catch (error) {
    serverLogger.error("[esbuild] Failed to load esbuild during startup", error);
  }
}

if (isDenoCompiled) {
  if (!Deno.env.get("ESBUILD_BINARY_PATH")) {
    try {
      const binaryPath = await extractEsbuildBinary();
      if (binaryPath) {
        Deno.env.set("ESBUILD_BINARY_PATH", binaryPath);
        process.env.ESBUILD_BINARY_PATH = binaryPath;
      }
    } catch (error) {
      serverLogger.error("[esbuild] Binary extraction failed", error);
    }
  }

  // Runs even when the path was already set in the environment: the binding
  // esbuild makes at module load is what matters, not who set the variable.
  await primeEsbuildModule();
}
