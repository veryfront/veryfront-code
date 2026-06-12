/**
 * Binary extraction for `deno compile` VFS.
 *
 * Ported from src/platform/compat/esbuild.ts + esbuild-shared.ts. When the
 * framework runs as a compiled Deno binary, the esbuild native binary lives
 * inside the VFS and must be copied to a writable path before esbuild's
 * child-process spawn can find it.
 *
 * On normal Deno (not `deno compile`) or when ESBUILD_BINARY_PATH is already
 * set, `ensureEsbuildBinary()` is a no-op.
 *
 * @module extensions/ext-bundler-esbuild/binary
 */

import { isDenoCompiled } from "./runtime.ts";

const ESBUILD_VERSION = "0.28.1";

function getTempDir(): string {
  try {
    return (
      Deno.env.get("TMPDIR") ?? Deno.env.get("TEMP") ?? Deno.env.get("TMP") ?? "/tmp"
    );
  } catch {
    return "/tmp";
  }
}

function getEsbuildBinaryName(): string {
  const archMap: Record<string, string> = { x86_64: "x64", aarch64: "arm64" };
  const arch = archMap[Deno.build.arch] ?? Deno.build.arch;
  return `@esbuild/${Deno.build.os}-${arch}`;
}

function getVFSBasePath(filePath: string, tempDir: string): string {
  const denoCompileMatch = filePath.match(/^(.*\/deno-compile-[^/]+)\//);
  if (denoCompileMatch?.[1]) return denoCompileMatch[1];
  const parts = filePath.split("/");
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex > 0) return parts.slice(0, srcIndex).join("/");
  return `${tempDir}/deno-compile-veryfront`;
}

async function isFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
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

  for (const p of possiblePaths) {
    if (await isFile(p)) return p;
  }

  try {
    const nodeModulesPath = `${vfsBase}/node_modules`;
    for await (const entry of Deno.readDir(nodeModulesPath)) {
      if (entry.name !== binaryName && !entry.name.startsWith("@esbuild")) continue;
      const binPath = `${nodeModulesPath}/${entry.name}/bin/esbuild`;
      if (await isFile(binPath)) return binPath;
    }
  } catch {
    /* node_modules not readable in VFS */
  }

  return null;
}

async function extractEsbuildBinary(): Promise<string> {
  const cacheDir = `${getTempDir()}/veryfront-esbuild`;
  const targetPath = `${cacheDir}/esbuild-${ESBUILD_VERSION}`;

  try {
    const stat = await Deno.stat(targetPath);
    if (stat.isFile && stat.mode && (stat.mode & 0o111)) return targetPath;
  } catch {
    /* cache miss */
  }

  const vfsPath = await findEsbuildInVFS();
  if (!vfsPath) {
    throw new Error(
      `[ext-bundler-esbuild] Could not find esbuild binary in deno compile VFS. ` +
        `Platform: ${getEsbuildBinaryName()}. ` +
        `Ensure esbuild is in dependencies and deno compile includes node_modules.`,
    );
  }

  await Deno.mkdir(cacheDir, { recursive: true });
  const binary = await Deno.readFile(vfsPath);
  await Deno.writeFile(targetPath, binary, { mode: 0o755 });

  return targetPath;
}

let setupComplete = false;
let setupPromise: Promise<void> | null = null;

/**
 * Idempotent one-shot setup — copies the esbuild binary out of the VFS (if
 * running in `deno compile`) and sets ESBUILD_BINARY_PATH. No-op on normal
 * Deno or when the env var is already set.
 */
export async function ensureEsbuildBinary(): Promise<void> {
  if (setupComplete) return;
  if (setupPromise) {
    await setupPromise;
    return;
  }

  setupPromise = (async () => {
    try {
      if (Deno.env.get("ESBUILD_BINARY_PATH") || !isDenoCompiled) {
        setupComplete = true;
        return;
      }

      try {
        const binaryPath = await extractEsbuildBinary();
        Deno.env.set("ESBUILD_BINARY_PATH", binaryPath);
        // esbuild reads process.env (not Deno.env) on some code paths.
        const proc = (globalThis as { process?: { env: Record<string, string> } }).process;
        if (proc?.env) proc.env.ESBUILD_BINARY_PATH = binaryPath;
      } catch (err) {
        console.error("[ext-bundler-esbuild] Binary extraction failed:", err);
      }
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
