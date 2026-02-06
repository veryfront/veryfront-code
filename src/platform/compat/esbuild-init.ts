/**
 * Early esbuild binary initialization for deno compile.
 * MUST be imported at CLI entry point BEFORE any esbuild imports.
 */

import process from "node:process";
import { isDenoCompiled } from "./runtime.ts";
import { ESBUILD_VERSION, getEsbuildBinaryName, getVFSBasePath } from "./esbuild-shared.ts";

function getTempDir(): string {
  return Deno.env.get("TMPDIR") ?? Deno.env.get("TEMP") ?? Deno.env.get("TMP") ?? "/tmp";
}

function getEsbuildCacheDir(): string {
  return `${getTempDir()}/veryfront-esbuild`;
}

async function findEsbuildInVFS(): Promise<string | null> {
  const binaryName = getEsbuildBinaryName();
  const vfsBase = getVFSBasePath(new URL(import.meta.url).pathname, getTempDir());

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
    } catch {
      // ignore
    }
  }

  return null;
}

async function extractEsbuildBinary(): Promise<string | null> {
  const cacheDir = getEsbuildCacheDir();
  const targetPath = `${cacheDir}/esbuild-${ESBUILD_VERSION}`;

  try {
    const stat = await Deno.stat(targetPath);
    if (stat.isFile && stat.mode && (stat.mode & 0o111)) return targetPath;
  } catch {
    // doesn't exist
  }

  const vfsPath = await findEsbuildInVFS();
  if (!vfsPath) return null;

  await Deno.mkdir(cacheDir, { recursive: true });
  await Deno.writeFile(targetPath, await Deno.readFile(vfsPath), { mode: 0o755 });

  console.log(`[esbuild] Extracted binary from VFS to ${targetPath}`);
  return targetPath;
}

if (!Deno.env.get("ESBUILD_BINARY_PATH") && isDenoCompiled) {
  try {
    const binaryPath = await extractEsbuildBinary();
    if (!binaryPath) {
      // no-op
    } else {
      Deno.env.set("ESBUILD_BINARY_PATH", binaryPath);
      process.env.ESBUILD_BINARY_PATH = binaryPath;
      console.log(`[esbuild] Set ESBUILD_BINARY_PATH=${binaryPath}`);
    }
  } catch (error) {
    console.warn(`[esbuild] Binary extraction failed:`, error);
  }
}
