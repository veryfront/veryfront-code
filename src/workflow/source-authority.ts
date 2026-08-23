import { CONFIG_INVALID } from "#veryfront/errors";
import { MAX_URL_LENGTH_FOR_VALIDATION } from "#veryfront/utils/constants/limits.ts";
import { MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS } from "./limits.ts";

const MISSING = Symbol("missing-workflow-source-authority-property");
type AuthorityProperty = unknown | typeof MISSING;
const NativeURL = URL;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectApply = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringIndexOf = String.prototype.indexOf;
const stringNormalize = String.prototype.normalize;
const stringSlice = String.prototype.slice;
const stringTrim = String.prototype.trim;
const urlHashGetter = objectGetOwnPropertyDescriptor(URL.prototype, "hash")!.get!;
const urlHrefGetter = objectGetOwnPropertyDescriptor(URL.prototype, "href")!.get!;
const urlPasswordGetter = objectGetOwnPropertyDescriptor(URL.prototype, "password")!.get!;
const urlProtocolGetter = objectGetOwnPropertyDescriptor(URL.prototype, "protocol")!.get!;
const urlSearchGetter = objectGetOwnPropertyDescriptor(URL.prototype, "search")!.get!;
const urlUsernameGetter = objectGetOwnPropertyDescriptor(URL.prototype, "username")!.get!;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = reflectApply(stringCharCodeAt, value, [index]) as number;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isCanonicalSourceIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS &&
    reflectApply(stringTrim, value, []) === value &&
    reflectApply(stringNormalize, value, ["NFC"]) === value &&
    !hasControlCharacters(value);
}

export interface WorkflowSourceAuthority {
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
}

export type WorkflowContentSource =
  | { type: "release"; releaseId: string }
  | { type: "environment"; name: string }
  | { type: "branch"; branch: string };

function invalidSourceAuthority(detail: string): never {
  throw CONFIG_INVALID.create({ detail });
}

function readAuthorityProperty(
  authority: WorkflowSourceAuthority,
  key: keyof WorkflowSourceAuthority,
): AuthorityProperty {
  if (typeof authority !== "object" || authority === null) {
    invalidSourceAuthority("Workflow source authority must be an object");
  }

  try {
    const descriptor = objectGetOwnPropertyDescriptor(authority, key);
    if (descriptor === undefined) return MISSING;
    if (!("value" in descriptor)) {
      invalidSourceAuthority("Workflow source authority must contain only own data properties");
    }
    return descriptor.value;
  } catch {
    invalidSourceAuthority("Workflow source authority must contain only own data properties");
  }
}

function optionalSourceIdentifier(
  value: AuthorityProperty,
  label: string,
): string | undefined {
  if (value === MISSING || value === undefined || value === null) {
    return undefined;
  }
  if (!isCanonicalSourceIdentifier(value)) {
    invalidSourceAuthority(
      `Workflow source authority ${label} must be a bounded non-empty canonical identifier`,
    );
  }
  return value;
}

/** Resolve the exact source snapshot selected by a captured tenant. */
export function requireWorkflowContentSource(
  authority: WorkflowSourceAuthority,
): WorkflowContentSource {
  const productionMode = readAuthorityProperty(authority, "productionMode");
  if (productionMode === MISSING || typeof productionMode !== "boolean") {
    invalidSourceAuthority(
      "Workflow source authority productionMode must be an explicit boolean",
    );
  }

  if (productionMode) {
    const releaseId = optionalSourceIdentifier(
      readAuthorityProperty(authority, "releaseId"),
      "release ID",
    );
    if (releaseId) return { type: "release", releaseId };

    const environmentName = optionalSourceIdentifier(
      readAuthorityProperty(authority, "environmentName"),
      "environment name",
    );
    if (environmentName) return { type: "environment", name: environmentName };

    invalidSourceAuthority(
      "Production workflow source authority requires a release ID or environment name",
    );
  }

  const branch = optionalSourceIdentifier(
    readAuthorityProperty(authority, "branch"),
    "branch",
  );
  if (!branch) {
    invalidSourceAuthority("Preview workflow source authority requires an explicit branch");
  }
  return { type: "branch", branch };
}

/** Validate the explicitly composed API endpoint used for source access. */
export function requireWorkflowApiBaseUrl(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw CONFIG_INVALID.create({
      detail: "Workflow source access requires an explicit VERYFRONT_API_URL",
    });
  }
  if (
    value.length > MAX_URL_LENGTH_FOR_VALIDATION ||
    value !== reflectApply(stringTrim, value, []) ||
    hasControlCharacters(value)
  ) {
    throw CONFIG_INVALID.create({
      detail: "VERYFRONT_API_URL must be a bounded canonical HTTP(S) URL",
    });
  }

  let parsed: URL;
  try {
    parsed = new NativeURL(value);
  } catch {
    throw CONFIG_INVALID.create({ detail: "VERYFRONT_API_URL must be a valid HTTP(S) URL" });
  }
  if (
    (reflectApply(urlProtocolGetter, parsed, []) !== "http:" &&
      reflectApply(urlProtocolGetter, parsed, []) !== "https:") ||
    reflectApply(urlUsernameGetter, parsed, []) ||
    reflectApply(urlPasswordGetter, parsed, []) ||
    reflectApply(urlSearchGetter, parsed, []) ||
    reflectApply(urlHashGetter, parsed, []) ||
    reflectApply(stringIndexOf, value, ["?"]) !== -1 ||
    reflectApply(stringIndexOf, value, ["#"]) !== -1
  ) {
    throw CONFIG_INVALID.create({ detail: "VERYFRONT_API_URL must be a valid HTTP(S) URL" });
  }

  const href = reflectApply(urlHrefGetter, parsed, []) as string;
  let canonicalLength = href.length;
  while (
    canonicalLength > 0 &&
    reflectApply(stringCharCodeAt, href, [canonicalLength - 1]) === 47
  ) canonicalLength--;
  const canonical = reflectApply(stringSlice, href, [0, canonicalLength]) as string;
  if (canonical.length === 0 || canonical.length > MAX_URL_LENGTH_FOR_VALIDATION) {
    throw CONFIG_INVALID.create({
      detail: "VERYFRONT_API_URL must be a bounded canonical HTTP(S) URL",
    });
  }
  return canonical;
}
