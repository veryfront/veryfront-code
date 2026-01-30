/**
 * Early esbuild binary initialization for deno compile.
 * MUST be imported at CLI entry point BEFORE any esbuild imports.
 */

import process from "node:process";
import { isDenoCompiled } from "./runtime.ts";

const ESBUILD_VERSION = "0.20.2";

function getTempDir(): string {
  return Deno.env.get("TMPDIR") ?? Deno.env.get("TEMP") ?? Deno.env.get("TMP") ?? "/tmp";
}

function getEsbuildCacheDir(): string {
  return `${getTempDir()}/veryfront-esbuild`;
}

function getEsbuildBinaryName(): string {
  const archMap: Record<string, string> = {
    x86_64: "x64",
    aarch64: "arm64",
  };
  const esbuildArch = archMap[Deno.build.arch] || Deno.build.arch;
  return `@esbuild/${Deno.build.os}-${esbuildArch}`;
}

function getVFSBasePath(): string {
  const filePath = new URL(import.meta.url).pathname;
  const denoCompileMatch = filePath.match(/^(.*\/deno-compile-[^/]+)\//);
  if (denoCompileMatch?.[1]) {
    return denoCompileMatch[1];
  }
  const parts = filePath.split("/");
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex > 0) {
    return parts.slice(0, srcIndex).join("/");
  }
  return `${getTempDir()}/deno-compile-veryfront`;
}

async function findEsbuildInVFS(): Promise<string | null> {
  const binaryName = getEsbuildBinaryName();
  const vfsBase = getVFSBasePath();

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
      continue;
    }
  }
  return null;
}

async function extractEsbuildBinary(): Promise<string | null> {
  const cacheDir = getEsbuildCacheDir();
  const targetPath = `${cacheDir}/esbuild-${ESBUILD_VERSION}`;

  // Check if already extracted
  try {
    const stat = await Deno.stat(targetPath);
    if (stat.isFile && stat.mode && (stat.mode & 0o111)) {
      return targetPath;
    }
  } catch {
    // Doesn't exist, need to extract
  }

  const vfsPath = await findEsbuildInVFS();
  if (!vfsPath) {
    return null;
  }

  await Deno.mkdir(cacheDir, { recursive: true });
  const binary = await Deno.readFile(vfsPath);
  await Deno.writeFile(targetPath, binary, { mode: 0o755 });

  console.log(`[esbuild] Extracted binary from VFS to ${targetPath}`);
  return targetPath;
}

// Run initialization immediately when this module is imported
if (!Deno.env.get("ESBUILD_BINARY_PATH") && isDenoCompiled) {
  try {
    const binaryPath = await extractEsbuildBinary();
    if (binaryPath) {
      // Set in BOTH Deno.env and process.env
      Deno.env.set("ESBUILD_BINARY_PATH", binaryPath);
      process.env.ESBUILD_BINARY_PATH = binaryPath;
      console.log(`[esbuild] Set ESBUILD_BINARY_PATH=${binaryPath}`);
    }
  } catch (error) {
    console.warn(`[esbuild] Binary extraction failed:`, error);
  }
}
