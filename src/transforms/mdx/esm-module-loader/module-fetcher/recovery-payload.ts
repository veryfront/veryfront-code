import { hasHardcodedCachePaths } from "#veryfront/cache/paths.ts";
import { buildMdxEsmModuleFileName, MDX_ESM_CACHE_NAMESPACE } from "../cache-format.ts";
import { hashString } from "../utils/hash.ts";

export const MDX_RECOVERY_PAYLOAD_VERSION = 1;
export const MAX_MDX_MODULE_CODE_BYTES = 2 * 1024 * 1024;
export const MAX_MDX_RECOVERY_PAYLOAD_BYTES = MAX_MDX_MODULE_CODE_BYTES + 64 * 1024;
export const MAX_MDX_RECOVERY_MODULES = 256;
export const MAX_MDX_RECOVERY_DEPTH = 32;
export const MAX_MDX_RECOVERY_TOTAL_BYTES = 16 * 1024 * 1024;

const encoder = new TextEncoder();
const CURRENT_MODULE_FILE_PATTERN = new RegExp(
  `^vfmod-${escapeRegExp(MDX_ESM_CACHE_NAMESPACE)}-[a-f0-9]{64}\\.mjs$`,
);

export interface MdxModuleRecoveryPayload {
  version: typeof MDX_RECOVERY_PAYLOAD_VERSION;
  projectIdHash: string;
  contentSourceIdHash: string;
  normalizedPath: string;
  fileName: string;
  portableCode: string;
  codeHash: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function isSafeNormalizedModulePath(value: string): boolean {
  if (value.length === 0 || value.length > 4096 || value.includes("\0")) return false;
  if (!value.startsWith("_vf_modules/")) return false;
  return !value.split("/").some((segment) => segment === "." || segment === "..");
}

export function createMdxModuleRecoveryPayload(
  projectId: string,
  contentSourceId: string,
  normalizedPath: string,
  portableCode: string,
): MdxModuleRecoveryPayload {
  if (!isSafeNormalizedModulePath(normalizedPath)) {
    throw new TypeError(`Invalid normalized MDX module path: ${normalizedPath.slice(0, 120)}`);
  }
  if (utf8ByteLength(portableCode) > MAX_MDX_MODULE_CODE_BYTES) {
    throw new RangeError("MDX module exceeds the distributed recovery size limit");
  }
  if (hasHardcodedCachePaths(portableCode)) {
    throw new TypeError("MDX recovery payload contains a non-portable cache path");
  }

  const fileName = buildMdxEsmModuleFileName(hashString(normalizedPath + portableCode));
  return {
    version: MDX_RECOVERY_PAYLOAD_VERSION,
    projectIdHash: hashString(projectId),
    contentSourceIdHash: hashString(contentSourceId),
    normalizedPath,
    fileName,
    portableCode,
    codeHash: hashString(portableCode),
  };
}

export function serializeMdxModuleRecoveryPayload(payload: MdxModuleRecoveryPayload): string {
  const serialized = JSON.stringify(payload);
  if (utf8ByteLength(serialized) > MAX_MDX_RECOVERY_PAYLOAD_BYTES) {
    throw new RangeError("MDX recovery payload exceeds the serialized size limit");
  }
  return serialized;
}

export function parseMdxModuleRecoveryPayload(
  serialized: string,
  expected: { projectId: string; contentSourceId: string; fileName: string },
): MdxModuleRecoveryPayload | null {
  // Reject cheaply before UTF-8 allocation/JSON parsing. UTF-8 is never fewer
  // bytes than UTF-16 code units for this payload's JSON representation.
  if (serialized.length > MAX_MDX_RECOVERY_PAYLOAD_BYTES) return null;
  if (utf8ByteLength(serialized) > MAX_MDX_RECOVERY_PAYLOAD_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (_) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const payload = value as Partial<MdxModuleRecoveryPayload>;
  if (
    payload.version !== MDX_RECOVERY_PAYLOAD_VERSION ||
    typeof payload.projectIdHash !== "string" ||
    typeof payload.contentSourceIdHash !== "string" ||
    typeof payload.normalizedPath !== "string" ||
    typeof payload.fileName !== "string" ||
    typeof payload.portableCode !== "string" ||
    typeof payload.codeHash !== "string"
  ) {
    return null;
  }
  if (
    payload.projectIdHash !== hashString(expected.projectId) ||
    payload.contentSourceIdHash !== hashString(expected.contentSourceId) ||
    payload.fileName !== expected.fileName ||
    !CURRENT_MODULE_FILE_PATTERN.test(payload.fileName) ||
    !isSafeNormalizedModulePath(payload.normalizedPath) ||
    utf8ByteLength(payload.portableCode) > MAX_MDX_MODULE_CODE_BYTES ||
    hasHardcodedCachePaths(payload.portableCode) ||
    payload.codeHash !== hashString(payload.portableCode)
  ) {
    return null;
  }

  const expectedFileName = buildMdxEsmModuleFileName(
    hashString(payload.normalizedPath + payload.portableCode),
  );
  return expectedFileName === payload.fileName ? payload as MdxModuleRecoveryPayload : null;
}
