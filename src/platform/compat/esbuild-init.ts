/**
 * Early esbuild binary initialization for deno compile.
 * MUST be imported at CLI entry point BEFORE any esbuild imports.
 */

import process from "node:process";
import { INITIALIZATION_ERROR } from "#veryfront/errors/error-registry/general.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { dirname, fromFileUrl, join } from "./path/index.ts";
import { isDenoCompiled } from "./runtime.ts";
import {
  ESBUILD_VERSION,
  type EsbuildBuildTarget,
  getEsbuildBinaryName,
  getVFSBasePath,
} from "./esbuild-shared.ts";

const ESBUILD_BINARY_PATH = "ESBUILD_BINARY_PATH";
const EXTRACTION_MODE = 0o700;

export interface EsbuildEnvironment {
  delete(name: string): void;
  get(name: string): string | undefined;
  set(name: string, value: string): void;
}

export interface EsbuildFileInfo {
  isFile: boolean;
  mode: number | null;
  size: number;
}

/** Runtime boundary used by the import side effect and focused tests. */
export interface EsbuildInitializationRuntime {
  build: EsbuildBuildTarget;
  denoEnv: EsbuildEnvironment;
  isCompiled: boolean;
  moduleUrl: string;
  processEnv: EsbuildEnvironment;
  chmod(path: string, mode: number): Promise<void>;
  makeTempDir(options: { prefix: string }): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  registerCleanup(path: string): void;
  remove(path: string): Promise<void>;
  stat(path: string): Promise<EsbuildFileInfo | null>;
  writeFile(
    path: string,
    data: Uint8Array,
    options: { createNew: true; mode: number },
  ): Promise<void>;
}

type InitializationFailureReason =
  | "binary-invalid"
  | "binary-not-found"
  | "environment-read-failed"
  | "environment-write-failed"
  | "extraction-failed"
  | "module-url-invalid";

const INITIALIZATION_DETAILS: Readonly<Record<InitializationFailureReason, string>> = {
  "binary-invalid":
    "The compiled esbuild binary is empty, incomplete, or not executable. Rebuild the Veryfront executable.",
  "binary-not-found":
    "The compiled Veryfront executable does not include a compatible esbuild binary. Rebuild it with esbuild dependencies included.",
  "environment-read-failed":
    "Veryfront cannot configure ESBUILD_BINARY_PATH. Grant environment access and start Veryfront again.",
  "environment-write-failed":
    "Veryfront cannot configure ESBUILD_BINARY_PATH. Grant environment access and start Veryfront again.",
  "extraction-failed":
    "Veryfront cannot prepare the compiled esbuild binary. Ensure the system temporary directory is writable.",
  "module-url-invalid":
    "Veryfront cannot locate the compiled esbuild binary from the current module URL. Rebuild the Veryfront executable.",
};

interface EnvironmentSnapshot {
  deno: string | undefined;
  process: string | undefined;
}

function initializationError(reason: InitializationFailureReason): VeryfrontError {
  return INITIALIZATION_ERROR.create({
    context: { component: "esbuild", reason },
    detail: INITIALIZATION_DETAILS[reason],
    message: "Veryfront could not initialize esbuild.",
  });
}

function isInitializationError(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError && error.slug === "initialization-error";
}

function readEnvironment(runtime: EsbuildInitializationRuntime): EnvironmentSnapshot {
  try {
    const deno = runtime.denoEnv.get(ESBUILD_BINARY_PATH);
    if (typeof deno === "string" && deno.length > 0) {
      return { deno, process: undefined };
    }
    return {
      deno,
      process: runtime.processEnv.get(ESBUILD_BINARY_PATH),
    };
  } catch {
    throw initializationError("environment-read-failed");
  }
}

function hasConfiguredBinaryPath(snapshot: EnvironmentSnapshot): boolean {
  return (typeof snapshot.deno === "string" && snapshot.deno.length > 0) ||
    (typeof snapshot.process === "string" && snapshot.process.length > 0);
}

function restoreEnvironmentValue(
  environment: EsbuildEnvironment,
  previousValue: string | undefined,
): void {
  try {
    if (previousValue === undefined) environment.delete(ESBUILD_BINARY_PATH);
    else environment.set(ESBUILD_BINARY_PATH, previousValue);
  } catch {
    // The caller reports a sanitized environment failure. Do not expose host details.
  }
}

function publishBinaryPath(
  runtime: EsbuildInitializationRuntime,
  binaryPath: string,
  previous: EnvironmentSnapshot,
): void {
  try {
    runtime.denoEnv.set(ESBUILD_BINARY_PATH, binaryPath);
    runtime.processEnv.set(ESBUILD_BINARY_PATH, binaryPath);
  } catch {
    restoreEnvironmentValue(runtime.processEnv, previous.process);
    restoreEnvironmentValue(runtime.denoEnv, previous.deno);
    throw initializationError("environment-write-failed");
  }
}

async function removePartialExtraction(
  runtime: EsbuildInitializationRuntime,
  extractionDirectory: string,
): Promise<void> {
  try {
    await runtime.remove(extractionDirectory);
  } catch {
    // Preserve the primary sanitized initialization failure.
  }
}

function executableName(build: EsbuildBuildTarget): string {
  return build.os === "windows" ? "esbuild.exe" : "esbuild";
}

async function findEsbuildInVFS(
  runtime: EsbuildInitializationRuntime,
  vfsBase: string,
): Promise<string | null> {
  const binaryName = getEsbuildBinaryName(runtime.build);
  const denoPackageStoreName = binaryName.replace("/", "+");
  const binaryExecutable = executableName(runtime.build);
  const possiblePaths = [
    join(vfsBase, "node_modules", binaryName, "bin", binaryExecutable),
    join(
      vfsBase,
      "node_modules",
      ".deno",
      `${denoPackageStoreName}@${ESBUILD_VERSION}`,
      "node_modules",
      binaryName,
      "bin",
      binaryExecutable,
    ),
    join(
      vfsBase,
      "node_modules",
      ".deno",
      `${binaryName}@${ESBUILD_VERSION}`,
      "node_modules",
      binaryName,
      "bin",
      binaryExecutable,
    ),
    join(
      vfsBase,
      "node_modules",
      ".deno",
      `esbuild@${ESBUILD_VERSION}`,
      "node_modules",
      binaryName,
      "bin",
      binaryExecutable,
    ),
    join(
      vfsBase,
      "node_modules",
      ".package",
      `${binaryName}@${ESBUILD_VERSION}`,
      "bin",
      binaryExecutable,
    ),
  ];

  for (const path of possiblePaths) {
    const stat = await runtime.stat(path);
    if (stat?.isFile) return path;
  }

  return null;
}

async function prepareBinary(
  runtime: EsbuildInitializationRuntime,
  previousEnvironment: EnvironmentSnapshot,
): Promise<void> {
  let modulePath: string;
  try {
    modulePath = fromFileUrl(runtime.moduleUrl);
  } catch {
    throw initializationError("module-url-invalid");
  }

  let extractionDirectory: string | undefined;
  try {
    extractionDirectory = await runtime.makeTempDir({ prefix: "veryfront-esbuild-" });
    const vfsBase = getVFSBasePath(modulePath, dirname(extractionDirectory));
    const sourcePath = await findEsbuildInVFS(runtime, vfsBase);
    if (!sourcePath) throw initializationError("binary-not-found");

    const binary = await runtime.readFile(sourcePath);
    if (binary.byteLength === 0) throw initializationError("binary-invalid");

    const targetPath = join(extractionDirectory, executableName(runtime.build));
    await runtime.writeFile(targetPath, binary, {
      createNew: true,
      mode: EXTRACTION_MODE,
    });
    if (runtime.build.os !== "windows") {
      await runtime.chmod(targetPath, EXTRACTION_MODE);
    }

    const targetStat = await runtime.stat(targetPath);
    const executable = runtime.build.os === "windows" ||
      (targetStat?.mode !== null && targetStat?.mode !== undefined &&
        (targetStat.mode & 0o100) !== 0);
    if (
      !targetStat?.isFile || targetStat.size !== binary.byteLength || targetStat.size === 0 ||
      !executable
    ) {
      throw initializationError("binary-invalid");
    }

    runtime.registerCleanup(extractionDirectory);
    publishBinaryPath(runtime, targetPath, previousEnvironment);
  } catch (error) {
    if (extractionDirectory) await removePartialExtraction(runtime, extractionDirectory);
    if (isInitializationError(error)) throw error;
    throw initializationError("extraction-failed");
  }
}

async function initializeEsbuildBinary(runtime: EsbuildInitializationRuntime): Promise<void> {
  if (!runtime.isCompiled) return;

  const previousEnvironment = readEnvironment(runtime);
  if (hasConfiguredBinaryPath(previousEnvironment)) return;

  await prepareBinary(runtime, previousEnvironment);
}

/**
 * Create an idempotent initializer. Concurrent callers share one extraction,
 * while a failed attempt can be retried after its private staging directory is removed.
 */
export function createEsbuildBinaryInitializer(
  runtime: EsbuildInitializationRuntime,
): () => Promise<void> {
  let complete = false;
  let pending: Promise<void> | undefined;

  return function ensureEsbuildBinary(): Promise<void> {
    if (complete) return Promise.resolve();
    if (pending) return pending;

    pending = initializeEsbuildBinary(runtime)
      .then(() => {
        complete = true;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

function createDenoInitializationRuntime(): EsbuildInitializationRuntime | null {
  if (typeof Deno === "undefined") return null;

  return {
    build: Deno.build,
    denoEnv: {
      delete: (name) => Deno.env.delete(name),
      get: (name) => Deno.env.get(name),
      set: (name, value) => Deno.env.set(name, value),
    },
    isCompiled: isDenoCompiled,
    moduleUrl: import.meta.url,
    processEnv: {
      delete: (name) => delete process.env[name],
      get: (name) => process.env[name],
      set: (name, value) => {
        process.env[name] = value;
      },
    },
    chmod: (path, mode) => Deno.chmod(path, mode),
    makeTempDir: (options) => Deno.makeTempDir(options),
    readFile: (path) => Deno.readFile(path),
    registerCleanup: (path) => {
      globalThis.addEventListener("unload", () => {
        try {
          Deno.removeSync(path, { recursive: true });
        } catch {
          // Cleanup is best effort during process shutdown.
        }
      }, { once: true });
    },
    remove: (path) => Deno.remove(path, { recursive: true }),
    stat: async (path) => {
      try {
        return await Deno.stat(path);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
      }
    },
    writeFile: (path, data, options) => Deno.writeFile(path, data, options),
  };
}

const denoInitializationRuntime = createDenoInitializationRuntime();
if (denoInitializationRuntime) {
  await createEsbuildBinaryInitializer(denoInitializationRuntime)();
}
