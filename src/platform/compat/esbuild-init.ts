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

if (isDenoCompiled && !Deno.env.get("ESBUILD_BINARY_PATH")) {
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
