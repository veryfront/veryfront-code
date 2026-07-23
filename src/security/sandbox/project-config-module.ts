import { VERYFRONT_CONFIG_FILES } from "#veryfront/config/config-files.ts";
import { transpileConfigSourceForImport, VERYFRONT_CONFIG_SHIM } from "#veryfront/config/loader.ts";
import {
  rewriteModuleSpecifiers,
  tokenizeJavaScriptSource,
} from "#veryfront/modules/loader-shared/import-specifiers.ts";
import {
  assertValidProjectSourceSnapshot,
  normalizeProjectSourcePath,
  type ProjectSourceSnapshot,
} from "./project-source-snapshot.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const PROJECT_CONFIG_MAX_MODULE_BYTES = 4 * 1024 * 1024;

/** JavaScript config payload prepared without importing project code in the host. */
export interface ProjectConfigModule {
  sourcePath: string;
  /** SHA-256 of the exact source bytes in the project snapshot. */
  sourceHash: string;
  /** ESM evaluated only by a dedicated project Worker. */
  moduleCode: string;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function assertValidProjectConfigModule(
  value: ProjectConfigModule,
): asserts value is ProjectConfigModule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project config module is invalid");
  }
  const normalized = normalizeProjectSourcePath(value.sourcePath, "/", true);
  if (normalized !== value.sourcePath || !VERYFRONT_CONFIG_FILES.includes(normalized as never)) {
    throw new TypeError("Project config module path is invalid");
  }
  if (!SHA256_PATTERN.test(value.sourceHash)) {
    throw new TypeError("Project config source hash is invalid");
  }
  if (typeof value.moduleCode !== "string" || value.moduleCode.length === 0) {
    throw new TypeError("Project config module code is invalid");
  }
  if (byteLength(value.moduleCode) > PROJECT_CONFIG_MAX_MODULE_BYTES) {
    throw new RangeError("Project config module exceeds the byte limit");
  }
}

function decodeConfigSource(bytes: Uint8Array): string {
  if (bytes.byteLength > PROJECT_CONFIG_MAX_MODULE_BYTES) {
    throw new RangeError("Project config source exceeds the byte limit");
  }
  try {
    return decoder.decode(bytes);
  } catch {
    throw new TypeError("Project config source must use valid UTF-8");
  }
}

const ISOLATED_CONFIG_HELPER_URL = `data:text/javascript;charset=utf-8,${
  encodeURIComponent(VERYFRONT_CONFIG_SHIM)
}`;

function rewriteIsolatedConfigImports(moduleCode: string): string {
  const tokens = tokenizeJavaScriptSource(moduleCode);
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]?.value !== "import" || tokens[index - 1]?.value === ".") continue;
    if (tokens[index + 1]?.value === "(" && tokens[index + 2]?.type !== "string") {
      throw new TypeError(
        "Remote project config imports require snapshot-bound config bundling",
      );
    }
  }

  return rewriteModuleSpecifiers(moduleCode, (specifier, dynamic) => {
    if (!dynamic && specifier === "veryfront") return ISOLATED_CONFIG_HELPER_URL;
    throw new TypeError(
      "Remote project config imports require snapshot-bound config bundling",
    );
  });
}

/**
 * Locate and transform the selected project config without importing it.
 * Filename precedence intentionally matches `getConfig`.
 */
export async function prepareProjectConfigModule(
  snapshot: ProjectSourceSnapshot,
): Promise<ProjectConfigModule | undefined> {
  assertValidProjectSourceSnapshot(snapshot);
  const configFile = VERYFRONT_CONFIG_FILES
    .map((sourcePath) => snapshot.files.find((file) => file.sourcePath === sourcePath))
    .find((file) => file !== undefined);
  if (!configFile) return undefined;

  const source = decodeConfigSource(configFile.content);
  const transformedModuleCode = configFile.sourcePath.endsWith(".ts")
    ? await transpileConfigSourceForImport(source, configFile.sourcePath)
    : source;
  const moduleCode = rewriteIsolatedConfigImports(transformedModuleCode);
  const result: ProjectConfigModule = {
    sourcePath: configFile.sourcePath,
    sourceHash: await hashBytes(configFile.content),
    moduleCode,
  };
  assertValidProjectConfigModule(result);
  return result;
}
