import {
  isCanonicalProjectSlug,
  MAX_OPAQUE_ID_CODE_UNITS,
} from "#veryfront/utils/project-identity.ts";
import {
  RELEASE_MODULE_RUNTIME_VERSION_PARAM,
  RELEASE_MODULE_VERSION_PARAM,
} from "#veryfront/release-assets/constants.ts";

const MAX_MODULE_QUERY_CODE_UNITS = 16 * 1024;
const MAX_MODULE_QUERY_PARAMETERS = 64;
const MAX_MODULE_QUERY_NAME_CODE_UNITS = 128;
const MAX_MODULE_QUERY_VALUE_CODE_UNITS = 8 * 1024;
const MAX_HMR_TOKEN_CODE_UNITS = 256;

const SINGLE_VALUE_PARAMETERS = new Set([
  "branch",
  "project",
  "ssr",
  "studio_embed",
  "t",
  "v",
  RELEASE_MODULE_VERSION_PARAM,
  RELEASE_MODULE_RUNTIME_VERSION_PARAM,
]);

export interface ModuleRequestQuery {
  branch: string | null;
  hmrToken: string | null;
  projectSlug: string | null;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function assertStableQueryText(
  value: string,
  label: string,
  maxCodeUnits: number,
  allowEmpty = true,
): void {
  if (
    (!allowEmpty && value.length === 0) ||
    value.length > maxCodeUnits ||
    containsControlCharacter(value)
  ) {
    throw new TypeError(`${label} is outside the supported request boundary`);
  }

  try {
    encodeURIComponent(value);
  } catch {
    throw new TypeError(`${label} contains malformed text encoding`);
  }
}

function requireUniqueOptionalParameter(
  values: ReadonlyMap<string, readonly string[]>,
  name: string,
): string | null {
  const entries = values.get(name);
  if (!entries) return null;
  if (entries.length !== 1) {
    throw new TypeError(`Module query parameter "${name}" must not be repeated`);
  }

  const value = entries[0] ?? "";
  if (value.length === 0) {
    throw new TypeError(`Module query parameter "${name}" must not be empty`);
  }
  return value;
}

export function normalizeModuleProjectSlug(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (!isCanonicalProjectSlug(value)) {
    throw new TypeError("Module project slug must be canonical");
  }
  return value;
}

export function normalizeModuleBranch(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  if (
    value.length === 0 ||
    value.length > MAX_OPAQUE_ID_CODE_UNITS ||
    value !== value.trim() ||
    containsControlCharacter(value)
  ) {
    throw new TypeError("Module branch must be a bounded non-empty identity");
  }
  try {
    encodeURIComponent(value);
  } catch {
    throw new TypeError("Module branch contains malformed text encoding");
  }
  return value;
}

export function parseModuleRequestQuery(url: URL): ModuleRequestQuery {
  const encodedQueryLength = url.search.startsWith("?") ? url.search.length - 1 : url.search.length;
  if (encodedQueryLength > MAX_MODULE_QUERY_CODE_UNITS) {
    throw new RangeError("Module query exceeds the supported request boundary");
  }

  const values = new Map<string, string[]>();
  let parameterCount = 0;
  for (const [name, value] of url.searchParams) {
    parameterCount++;
    if (parameterCount > MAX_MODULE_QUERY_PARAMETERS) {
      throw new RangeError("Module query contains too many parameters");
    }
    assertStableQueryText(
      name,
      "Module query parameter name",
      MAX_MODULE_QUERY_NAME_CODE_UNITS,
      false,
    );
    assertStableQueryText(value, "Module query parameter value", MAX_MODULE_QUERY_VALUE_CODE_UNITS);

    const entries = values.get(name);
    if (entries) {
      entries.push(value);
    } else {
      values.set(name, [value]);
    }
  }

  for (const name of SINGLE_VALUE_PARAMETERS) {
    const entries = values.get(name);
    if (entries && entries.length > 1) {
      throw new TypeError(`Module query parameter "${name}" must not be repeated`);
    }
  }

  const projectSlug = normalizeModuleProjectSlug(
    requireUniqueOptionalParameter(values, "project"),
  );
  const branch = normalizeModuleBranch(requireUniqueOptionalParameter(values, "branch"));
  const hmrToken = requireUniqueOptionalParameter(values, "t");
  if (hmrToken !== null) {
    assertStableQueryText(hmrToken, "Module HMR token", MAX_HMR_TOKEN_CODE_UNITS);
    if (hmrToken !== hmrToken.trim()) {
      throw new TypeError("Module HMR token must not have surrounding whitespace");
    }
  }

  return Object.freeze({ branch, hmrToken, projectSlug });
}
