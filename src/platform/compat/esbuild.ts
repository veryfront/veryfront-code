/**
 * esbuild compatibility layer with deno compile support.
 * Extracts esbuild binary from VFS to temp dir on first use in compiled binaries.
 * Sets ESBUILD_BINARY_PATH in both Deno.env and process.env (esbuild reads process.env).
 */

export type { BuildOptions, BuildResult, TransformOptions, TransformResult } from "esbuild";

import nodeProcess from "node:process";
import { getEnv, setEnv } from "./process.ts";
import { isDenoCompiled } from "./runtime.ts";
import { ESBUILD_VERSION, getEsbuildBinaryName, getVFSBasePath } from "./esbuild-shared.ts";

function getTempDir(): string {
  return getEnv("TMPDIR") ?? getEnv("TEMP") ?? getEnv("TMP") ?? "/tmp";
}

function getEsbuildCacheDir(): string {
  return `${getTempDir()}/veryfront-esbuild`;
}

let esbuildModule: typeof import("esbuild") | null = null;
let setupComplete = false;
let setupPromise: Promise<void> | null = null;

async function isFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch (_) {
    /* expected: file may not exist */
    return false;
  }
}

async function findEsbuildInVFS(): Promise<string | null> {
  const binaryName = getEsbuildBinaryName();
  const vfsBase = getVFSBasePath(new URL(import.meta.url).pathname, getTempDir());

  const possiblePaths = [
    `${vfsBase}/node_modules/${binaryName}/bin/esbuild`,
    `${vfsBase}/node_modules/.deno/${binaryName}@${ESBUILD_VERSION}/node_modules/${binaryName}/bin/esbuild`,
    `${vfsBase}/node_modules/.deno/esbuild@${ESBUILD_VERSION}/node_modules/${binaryName}/bin/esbuild`,
    `${vfsBase}/node_modules/esbuild/bin/esbuild`,
    `${vfsBase}/node_modules/.package/esbuild@${ESBUILD_VERSION}/bin/esbuild`,
    `${vfsBase}/node_modules/.package/${binaryName}@${ESBUILD_VERSION}/bin/esbuild`,
  ];

  for (const vfsPath of possiblePaths) {
    if (await isFile(vfsPath)) return vfsPath;
  }

  try {
    const nodeModulesPath = `${vfsBase}/node_modules`;
    for await (const entry of Deno.readDir(nodeModulesPath)) {
      if (entry.name !== binaryName && !entry.name.startsWith("@esbuild")) continue;

      const binPath = `${nodeModulesPath}/${entry.name}/bin/esbuild`;
      if (await isFile(binPath)) return binPath;
    }
  } catch (_) {
    /* expected: node_modules directory may not be readable in VFS */
  }

  return null;
}

async function extractEsbuildBinary(): Promise<string> {
  const cacheDir = getEsbuildCacheDir();
  const targetPath = `${cacheDir}/esbuild-${ESBUILD_VERSION}`;

  try {
    const stat = await Deno.stat(targetPath);
    if (stat.isFile && stat.mode && (stat.mode & 0o111)) return targetPath;
  } catch (_) {
    /* expected: cached binary does not exist yet, need to extract */
  }

  const vfsPath = await findEsbuildInVFS();
  if (!vfsPath) {
    const vfsBase = getVFSBasePath(new URL(import.meta.url).pathname, getTempDir());
    throw new Error(
      `Could not find esbuild binary in deno compile VFS.\n` +
        `  Platform: ${getEsbuildBinaryName()}\n` +
        `  VFS base: ${vfsBase}\n` +
        `  Tip: Ensure esbuild is in dependencies and deno compile includes node_modules.`,
    );
  }

  await Deno.mkdir(cacheDir, { recursive: true });

  const binary = await Deno.readFile(vfsPath);
  await Deno.writeFile(targetPath, binary, { mode: 0o755 });

  return targetPath;
}

async function ensureEsbuildBinary(): Promise<void> {
  if (setupComplete) return;

  if (setupPromise) {
    await setupPromise;
    return;
  }

  setupPromise = (async () => {
    if (getEnv("ESBUILD_BINARY_PATH") || !isDenoCompiled) {
      setupComplete = true;
      return;
    }

    try {
      const binaryPath = await extractEsbuildBinary();
      setEnv("ESBUILD_BINARY_PATH", binaryPath);
      nodeProcess.env.ESBUILD_BINARY_PATH = binaryPath;
    } catch (error) {
      console.warn(`[esbuild] Binary extraction failed:`, error);
    } finally {
      setupComplete = true;
    }
  })();

  try {
    await setupPromise;
  } finally {
    setupPromise = null;
  }
}

export async function getEsbuild(): Promise<typeof import("esbuild")> {
  await ensureEsbuildBinary();
  if (esbuildModule) return esbuildModule;

  esbuildModule = await import("esbuild");
  return esbuildModule;
}

export async function transform(
  code: string,
  options?: import("esbuild").TransformOptions,
): Promise<import("esbuild").TransformResult> {
  const esbuild = await getEsbuild();
  return esbuild.transform(code, options);
}

export async function build(
  options: import("esbuild").BuildOptions,
): Promise<import("esbuild").BuildResult> {
  const esbuild = await getEsbuild();
  return esbuild.build(options);
}

export async function stop(): Promise<void> {
  const esbuild = await getEsbuild();
  esbuild.stop();
}

export function isEsbuildReady(): boolean {
  return setupComplete;
}

/** Eager initialization for server startup. */
export async function initializeEsbuild(): Promise<void> {
  await ensureEsbuildBinary();
}
