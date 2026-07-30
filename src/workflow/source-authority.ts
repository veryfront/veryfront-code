import { CONFIG_INVALID } from "#veryfront/errors";
import { getOwnDataProperty, isMissingOwnDataProperty } from "#veryfront/tool/data-properties.ts";
import { MAX_URL_LENGTH_FOR_VALIDATION } from "#veryfront/utils/constants/limits.ts";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalOpaqueProjectIdentifier,
} from "#veryfront/utils/project-identity.ts";

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
): ReturnType<typeof getOwnDataProperty> {
  if (typeof authority !== "object" || authority === null) {
    invalidSourceAuthority("Workflow source authority must be an object");
  }

  try {
    return getOwnDataProperty(authority, key, "Workflow source authority");
  } catch {
    invalidSourceAuthority("Workflow source authority must contain only own data properties");
  }
}

function optionalSourceIdentifier(
  value: ReturnType<typeof getOwnDataProperty>,
  label: string,
): string | undefined {
  if (isMissingOwnDataProperty(value) || value === undefined || value === null) {
    return undefined;
  }
  if (!isCanonicalOpaqueProjectIdentifier(value)) {
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
  if (isMissingOwnDataProperty(productionMode) || typeof productionMode !== "boolean") {
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
    value !== value.trim() ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw CONFIG_INVALID.create({
      detail: "VERYFRONT_API_URL must be a bounded canonical HTTP(S) URL",
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw CONFIG_INVALID.create({ detail: "VERYFRONT_API_URL must be a valid HTTP(S) URL" });
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username ||
    parsed.password || parsed.search || parsed.hash || value.includes("?") || value.includes("#")
  ) {
    throw CONFIG_INVALID.create({ detail: "VERYFRONT_API_URL must be a valid HTTP(S) URL" });
  }

  const canonical = parsed.href.replace(/\/+$/, "");
  if (canonical.length === 0 || canonical.length > MAX_URL_LENGTH_FOR_VALIDATION) {
    throw CONFIG_INVALID.create({
      detail: "VERYFRONT_API_URL must be a bounded canonical HTTP(S) URL",
    });
  }
  return canonical;
}
