/**
 * esbuild Compatibility Layer
 *
 * Provides lazy-loading esbuild module access with support for deno compile.
 * When running as a compiled binary, esbuild's native binary is embedded in
 * Deno's VFS but cannot be executed from there. This module extracts it to
 * a real filesystem path on first use.
 *
 * @module platform/compat/esbuild
 */

export type { BuildOptions, BuildResult, TransformOptions, TransformResult } from "esbuild";

const ESBUILD_CACHE_DIR = "/tmp/veryfront-esbuild";
const ESBUILD_VERSION = "0.20.2";

let esbuildModule: typeof import("esbuild") | null = null;
let setupComplete = false;
let setupPromise: Promise<void> | null = null;

/**
 * Detect if running inside a deno compile binary.
 * Deno compile sets import.meta.main and embeds modules in a VFS.
 */
function isDenoCompiled(): boolean {
  // Check for deno compile VFS path indicator
  try {
    // In deno compile, the main module URL contains "deno-compile"
    const denoExecPath = Deno.execPath();
    // If execPath doesn't contain "deno" as a separate binary, we're likely compiled
    return !denoExecPath.includes("/deno") || denoExecPath.includes("veryfront");
  } catch {
    return false;
  }
}

/**
 * Get platform-specific esbuild binary name.
 */
function getEsbuildBinaryName(): string {
  const os = Deno.build.os;
  const arch = Deno.build.arch;

  // Map Deno's arch names to esbuild's
  const archMap: Record<string, string> = {
    x86_64: "x64",
    aarch64: "arm64",
  };

  const esbuildArch = archMap[arch] || arch;
  return `@esbuild/${os}-${esbuildArch}`;
}

/**
 * Get the VFS base path for the deno compile binary.
 * The VFS root is derived from import.meta.url of this module.
 */
function getVFSBasePath(): string {
  // import.meta.url in deno compile looks like:
  // file:///var/folders/.../deno-compile-{name}/src/platform/compat/esbuild.ts
  const url = new URL(import.meta.url);
  const filePath = url.pathname;

  // Find the deno-compile-* directory
  const denoCompileMatch = filePath.match(/^(.*\/deno-compile-[^/]+)\//);
  if (denoCompileMatch?.[1]) {
    return denoCompileMatch[1];
  }

  // Fallback: go up from current file to find node_modules
  // This file is at: {vfs}/src/platform/compat/esbuild.ts
  const parts = filePath.split("/");
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex > 0) {
    return parts.slice(0, srcIndex).join("/");
  }

  return "/tmp/deno-compile-veryfront";
}

/**
 * Find esbuild binary in deno compile VFS.
 * The VFS path varies based on how deno compile embeds node_modules.
 */
async function findEsbuildInVFS(): Promise<string | null> {
  const binaryName = getEsbuildBinaryName();
  const vfsBase = getVFSBasePath();

  // Possible VFS paths where esbuild binary might be located
  const possiblePaths = [
    // Platform-specific binary package (most common)
    `${vfsBase}/node_modules/${binaryName}/bin/esbuild`,
    // Deno's .deno cache structure
    `${vfsBase}/node_modules/.deno/${binaryName}@${ESBUILD_VERSION}/node_modules/${binaryName}/bin/esbuild`,
    // Main esbuild package bin
    `${vfsBase}/node_modules/.deno/esbuild@${ESBUILD_VERSION}/node_modules/${binaryName}/bin/esbuild`,
    `${vfsBase}/node_modules/esbuild/bin/esbuild`,
    // .package structure
    `${vfsBase}/node_modules/.package/esbuild@${ESBUILD_VERSION}/bin/esbuild`,
    `${vfsBase}/node_modules/.package/${binaryName}@${ESBUILD_VERSION}/bin/esbuild`,
  ];

  for (const vfsPath of possiblePaths) {
    try {
      const stat = await Deno.stat(vfsPath);
      if (stat.isFile) {
        return vfsPath;
      }
    } catch {
      // Path doesn't exist, try next
      continue;
    }
  }

  // If not found, try to list node_modules to discover structure
  try {
    const nodeModulesPath = `${vfsBase}/node_modules`;
    for await (const entry of Deno.readDir(nodeModulesPath)) {
      if (entry.name === binaryName || entry.name.startsWith("@esbuild")) {
        const binPath = `${nodeModulesPath}/${entry.name}/bin/esbuild`;
        try {
          const stat = await Deno.stat(binPath);
          if (stat.isFile) return binPath;
        } catch {
          continue;
        }
      }
    }
  } catch {
    // Can't read node_modules
  }

  return null;
}

/**
 * Extract esbuild binary from VFS to real filesystem.
 * This is necessary because deno compile embeds files in a VFS that
 * can be read but not executed.
 */
async function extractEsbuildBinary(): Promise<string> {
  const targetPath = `${ESBUILD_CACHE_DIR}/esbuild-${ESBUILD_VERSION}`;

  // Check if already extracted
  try {
    const stat = await Deno.stat(targetPath);
    if (stat.isFile && stat.mode && (stat.mode & 0o111)) {
      // Binary exists and is executable
      return targetPath;
    }
  } catch {
    // Doesn't exist, need to extract
  }

  // Find binary in VFS
  const vfsPath = await findEsbuildInVFS();
  if (!vfsPath) {
    const vfsBase = getVFSBasePath();
    throw new Error(
      `Could not find esbuild binary in deno compile VFS.\n` +
        `  Platform: ${getEsbuildBinaryName()}\n` +
        `  VFS base: ${vfsBase}\n` +
        `  Tip: Ensure esbuild is in dependencies and deno compile includes node_modules.`,
    );
  }

  // Create cache directory
  await Deno.mkdir(ESBUILD_CACHE_DIR, { recursive: true });

  // Read from VFS and write to real filesystem
  const binary = await Deno.readFile(vfsPath);
  await Deno.writeFile(targetPath, binary, { mode: 0o755 });

  console.log(`[esbuild] Extracted binary from VFS to ${targetPath}`);
  return targetPath;
}

/**
 * Ensure esbuild binary is available for execution.
 * In deno compile context, extracts binary from VFS first.
 */
async function ensureEsbuildBinary(): Promise<void> {
  if (setupComplete) return;
  if (setupPromise) {
    await setupPromise;
    return;
  }

  setupPromise = (async () => {
    // Skip if ESBUILD_BINARY_PATH already set (e.g., in Docker)
    if (Deno.env.get("ESBUILD_BINARY_PATH")) {
      setupComplete = true;
      return;
    }

    // Only extract if running as compiled binary
    if (!isDenoCompiled()) {
      setupComplete = true;
      return;
    }

    try {
      const binaryPath = await extractEsbuildBinary();
      Deno.env.set("ESBUILD_BINARY_PATH", binaryPath);
      console.log(`[esbuild] Set ESBUILD_BINARY_PATH=${binaryPath}`);
    } catch (error) {
      // Log but don't fail - esbuild might work anyway in some environments
      console.warn(`[esbuild] Binary extraction failed:`, error);
    }

    setupComplete = true;
  })();

  try {
    await setupPromise;
  } finally {
    setupPromise = null;
  }
}

/**
 * Get the esbuild module, ensuring binary is available first.
 */
export async function getEsbuild(): Promise<typeof import("esbuild")> {
  await ensureEsbuildBinary();

  if (esbuildModule) return esbuildModule;
  esbuildModule = await import("esbuild");
  return esbuildModule;
}

/**
 * Transform code using esbuild.
 */
export async function transform(
  code: string,
  options?: import("esbuild").TransformOptions,
): Promise<import("esbuild").TransformResult> {
  const esbuild = await getEsbuild();
  return esbuild.transform(code, options);
}

/**
 * Build using esbuild.
 */
export async function build(
  options: import("esbuild").BuildOptions,
): Promise<import("esbuild").BuildResult> {
  const esbuild = await getEsbuild();
  return esbuild.build(options);
}

/**
 * Stop the esbuild service.
 */
export async function stop(): Promise<void> {
  const esbuild = await getEsbuild();
  esbuild.stop();
}

/**
 * Check if esbuild setup is complete.
 */
export function isEsbuildReady(): boolean {
  return setupComplete;
}

/**
 * Manually trigger esbuild setup.
 * Useful for eager initialization during server startup.
 */
export async function initializeEsbuild(): Promise<void> {
  await ensureEsbuildBinary();
}
