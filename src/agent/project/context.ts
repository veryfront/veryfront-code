import { isErroredToolExecutionResult } from "#veryfront/tool/result.ts";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalOpaqueProjectIdentifier,
  isCanonicalProjectSlug,
  MAX_PROJECT_SLUG_CODE_UNITS,
  normalizeProjectSlug,
} from "#veryfront/utils/project-identity.ts";

const INVALID_OWN_DATA_PROPERTY = Symbol("invalid-own-data-property");
const MISSING_OWN_DATA_PROPERTY = Symbol("missing-own-data-property");
const ArrayIsArray = Array.isArray;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;

/** Stable error code for an unverified successful project-navigation result. */
export const PROJECT_CONTEXT_SWITCH_UNCONFIRMED_ERROR_CODE = "PROJECT_CONTEXT_SWITCH_UNCONFIRMED";

/** Stable model-visible message for an unverified project-navigation result. */
export const PROJECT_CONTEXT_SWITCH_UNCONFIRMED_MESSAGE =
  "Project navigation returned an identity that could not be verified; the active project was not changed.";

/** Stable validation message for an unsafe public project reference. */
export const INVALID_AGENT_PROJECT_REFERENCE_MESSAGE =
  "Project reference must be a trimmed non-empty bounded identifier without control characters";

/** Stable validation message for an unverified project-reference resolution. */
export const UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE =
  "Project reference resolver returned an unconfirmed project identity";

/** Context for mutable agent project. */
export interface MutableAgentProjectContext {
  projectId: string;
  projectSlug?: string;
  branchId?: string | null;
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch" | null;
  runtimeTargetEnvironmentId?: string | null;
  availableSkillIds?: string[];
  skillSelectorPolicy?: import("#veryfront/skill/selector.ts").ResolvedSkillSelectorPolicy;
  /** Per-run skill id -> discovered SKILL.md source path (owner-aware catalog). */
  skillSourcePaths?: Readonly<Record<string, string>>;
}

/** Apply agent project context change helper. */
export function applyAgentProjectContextChange(
  context: MutableAgentProjectContext,
  projectId: string,
  projectSlug?: string,
): boolean {
  const normalizedIdentity = normalizeAgentProjectIdentity(projectId, projectSlug);
  if (!normalizedIdentity) {
    return false;
  }

  const normalizedProjectSlug = normalizedIdentity.projectSlug;
  if (projectId === context.projectId) {
    if (normalizedProjectSlug === undefined || normalizedProjectSlug === context.projectSlug) {
      return false;
    }
    context.projectSlug = normalizedProjectSlug;
    return true;
  }

  context.projectId = projectId;
  // A slug belongs to the exact project identity that produced it. When the
  // switch result cannot prove the new slug, clear the old one instead of
  // pairing the new project id with stale project-scoped credentials.
  if (normalizedProjectSlug) {
    context.projectSlug = normalizedProjectSlug;
  } else {
    delete context.projectSlug;
  }
  context.branchId = null;
  context.runtimeTargetKind = "main_branch";
  context.runtimeTargetEnvironmentId = null;
  context.availableSkillIds = undefined;
  context.skillSourcePaths = undefined;
  return true;
}

/** Confirmed project identity returned by a successful project-navigation tool. */
export interface ConfirmedAgentProjectContextSwitch {
  projectId: string;
  projectSlug?: string;
}

/** Normalize a public project ID-or-slug reference without changing its identity. */
export function normalizeAgentProjectReference(value: unknown): string | null {
  return isCanonicalOpaqueProjectIdentifier(value) ? value : null;
}

/**
 * Validate and normalize one project identity at an untrusted boundary.
 *
 * Project IDs are opaque canonical values and therefore must already be
 * trimmed. Optional slugs may be whitespace-padded by upstream JSON and are
 * normalized exactly once before the canonical slug policy is applied.
 */
export function normalizeAgentProjectIdentity(
  projectId: unknown,
  rawProjectSlug?: unknown,
): ConfirmedAgentProjectContextSwitch | null {
  const normalizedProjectId = normalizeAgentProjectReference(projectId);
  if (!normalizedProjectId) {
    return null;
  }

  let projectSlug: string | undefined;
  if (rawProjectSlug !== undefined && rawProjectSlug !== null) {
    if (
      typeof rawProjectSlug !== "string" ||
      rawProjectSlug.length > MAX_PROJECT_SLUG_CODE_UNITS ||
      hasProjectIdentityControlCharacters(rawProjectSlug)
    ) {
      return null;
    }
    projectSlug = normalizeProjectSlug(rawProjectSlug) || undefined;
    if (projectSlug && !isCanonicalProjectSlug(projectSlug)) {
      return null;
    }
  }

  return {
    projectId: normalizedProjectId,
    ...(projectSlug ? { projectSlug } : {}),
  };
}

/**
 * Validate one resolved identity and prove that it names the requested
 * canonical project ID or normalized slug.
 */
export function getConfirmedAgentProjectIdentity(input: {
  projectId: unknown;
  projectSlug?: unknown;
  requestedProjectReference?: string;
}): ConfirmedAgentProjectContextSwitch | null {
  const identity = normalizeAgentProjectIdentity(input.projectId, input.projectSlug);
  if (
    !identity ||
    (
      input.requestedProjectReference !== undefined &&
      input.requestedProjectReference !== identity.projectId &&
      input.requestedProjectReference !== identity.projectSlug
    )
  ) {
    return null;
  }

  return identity;
}

/**
 * Confirm the own-data `{ projectId, slug }` shape returned by a hosted
 * project-reference resolver without invoking accessors on untrusted output.
 */
export function getConfirmedResolvedAgentProjectIdentity(
  resolution: unknown,
  requestedProjectReference: string,
): ConfirmedAgentProjectContextSwitch | null {
  return getConfirmedAgentProjectIdentity({
    projectId: readOwnDataProperty(resolution, "projectId"),
    projectSlug: readOptionalOwnDataProperty(resolution, "slug"),
    requestedProjectReference,
  });
}

/** Tool error returned when claimed navigation success cannot be safely confirmed. */
export interface UnconfirmedAgentProjectContextSwitchResult {
  success: false;
  isError: true;
  error: "tool_error";
  code: typeof PROJECT_CONTEXT_SWITCH_UNCONFIRMED_ERROR_CODE;
  message: typeof PROJECT_CONTEXT_SWITCH_UNCONFIRMED_MESSAGE;
  structuredContent: {
    success: false;
    error: "tool_error";
    code: typeof PROJECT_CONTEXT_SWITCH_UNCONFIRMED_ERROR_CODE;
    message: typeof PROJECT_CONTEXT_SWITCH_UNCONFIRMED_MESSAGE;
  };
}

/** Create a stable fail-closed tool result for an unverified navigation success. */
export function createUnconfirmedProjectContextSwitchResult(): UnconfirmedAgentProjectContextSwitchResult {
  return {
    success: false,
    isError: true,
    error: "tool_error",
    code: PROJECT_CONTEXT_SWITCH_UNCONFIRMED_ERROR_CODE,
    message: PROJECT_CONTEXT_SWITCH_UNCONFIRMED_MESSAGE,
    structuredContent: {
      success: false,
      error: "tool_error",
      code: PROJECT_CONTEXT_SWITCH_UNCONFIRMED_ERROR_CODE,
      message: PROJECT_CONTEXT_SWITCH_UNCONFIRMED_MESSAGE,
    },
  };
}

/**
 * Return the complete confirmed project identity from a successful navigation
 * result. A missing or blank slug is represented as absent so callers can
 * explicitly clear any prior project slug.
 */
export function getConfirmedProjectContextSwitch(
  result: unknown,
  requestedProjectReference?: string,
): ConfirmedAgentProjectContextSwitch | null {
  const content = getProjectContextSwitchContent(result);
  const resultSuccess = readOwnDataProperty(result, "success");
  if (
    !content ||
    isErroredToolExecutionResult(result) ||
    isErroredToolExecutionResult(content) ||
    resultSuccess === false ||
    resultSuccess === INVALID_OWN_DATA_PROPERTY ||
    readOwnDataProperty(content, "success") !== true
  ) {
    return null;
  }

  return getConfirmedAgentProjectIdentity({
    projectId: readOwnDataProperty(content, "project_id"),
    projectSlug: readOptionalOwnDataProperty(content, "slug"),
    requestedProjectReference,
  });
}

/**
 * Whether a non-error navigation result explicitly claims success.
 *
 * Callers use this to distinguish an ordinary upstream failure (which must be
 * preserved verbatim) from claimed success with an identity that failed the
 * confirmation boundary.
 */
export function isClaimedSuccessfulProjectContextSwitchResult(result: unknown): boolean {
  const content = getProjectContextSwitchContent(result);
  const resultSuccess = readOwnDataProperty(result, "success");
  const contentSuccess = content === null
    ? MISSING_OWN_DATA_PROPERTY
    : readOwnDataProperty(content, "success");
  if (
    isErroredToolExecutionResult(result) ||
    (content !== null && isErroredToolExecutionResult(content)) ||
    resultSuccess === false ||
    resultSuccess === INVALID_OWN_DATA_PROPERTY ||
    contentSuccess === false ||
    contentSuccess === INVALID_OWN_DATA_PROPERTY
  ) {
    return false;
  }

  return resultSuccess === true || contentSuccess === true;
}

/** Return only the confirmed project id for legacy callers. */
export function getConfirmedProjectContextSwitchId(
  result: unknown,
  requestedProjectReference?: string,
): string | null {
  return getConfirmedProjectContextSwitch(result, requestedProjectReference)?.projectId ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  try {
    return !ArrayIsArray(value);
  } catch {
    return false;
  }
}

function readOwnDataProperty(
  value: unknown,
  property: string,
): unknown | typeof INVALID_OWN_DATA_PROPERTY | typeof MISSING_OWN_DATA_PROPERTY {
  if (!isRecord(value)) {
    return MISSING_OWN_DATA_PROPERTY;
  }

  try {
    const descriptor = ObjectGetOwnPropertyDescriptor(value, property);
    if (!descriptor) {
      return MISSING_OWN_DATA_PROPERTY;
    }
    return ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"])
      ? descriptor.value
      : INVALID_OWN_DATA_PROPERTY;
  } catch {
    return INVALID_OWN_DATA_PROPERTY;
  }
}

function readOptionalOwnDataProperty(
  value: unknown,
  property: string,
): unknown | typeof INVALID_OWN_DATA_PROPERTY {
  const propertyValue = readOwnDataProperty(value, property);
  return propertyValue === MISSING_OWN_DATA_PROPERTY ? undefined : propertyValue;
}

function getProjectContextSwitchContent(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) {
    return null;
  }

  const structuredContent = readOwnDataProperty(result, "structuredContent");
  if (structuredContent !== MISSING_OWN_DATA_PROPERTY) {
    return structuredContent !== INVALID_OWN_DATA_PROPERTY && isRecord(structuredContent)
      ? structuredContent
      : null;
  }

  return result;
}
