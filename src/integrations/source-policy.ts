/**
 * Source-owned integration restrictions.
 *
 * This policy is deliberately monotonic: it can only remove integrations or
 * tools from the capabilities already granted by the agent source, catalog,
 * and control-plane policy. It never enables an integration, selects a
 * credential scope, or grants access on its own.
 */

import type { IntegrationName } from "./schema.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const apply = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringIndexOf = String.prototype.indexOf;
const stringLastIndexOf = String.prototype.lastIndexOf;
const stringSlice = String.prototype.slice;

export interface SourceIntegrationRestriction {
  /**
   * Exact connector-local tool IDs. Omit to allow every catalog tool for the
   * listed integration; use an empty array to allow none.
   */
  allowedTools?: readonly string[];
}

export interface SourceIntegrationPolicyConfig {
  /** Integrations that remain eligible after source-policy narrowing. */
  readonly allow: Readonly<Partial<Record<IntegrationName, SourceIntegrationRestriction>>>;
}

export type SourceIntegrationPolicyManifest =
  | {
    readonly schemaVersion: 1;
    readonly mode: "unrestricted";
  }
  | {
    readonly schemaVersion: 1;
    readonly mode: "allowlist";
    readonly integrations: Readonly<
      Record<
        string,
        Readonly<{
          /** `null` means every tool for this integration remains eligible. */
          readonly allowedToolIds: readonly string[] | null;
        }>
      >
    >;
  };

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY: SourceIntegrationPolicyManifest = Object.freeze({
  schemaVersion: 1,
  mode: "unrestricted",
});

const DENY_ALL_SOURCE_INTEGRATION_POLICY: SourceIntegrationPolicyManifest = Object.freeze({
  schemaVersion: 1,
  mode: "allowlist",
  integrations: Object.freeze({}),
});

function denyAllSourceIntegrationPolicy(): SourceIntegrationPolicyManifest {
  return DENY_ALL_SOURCE_INTEGRATION_POLICY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort(compareStrings);
  const sortedExpectedKeys = [...expectedKeys].sort(compareStrings);
  return actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

const CANONICAL_INTEGRATION_TOOL_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

/** Return whether a process-boundary value is an exact versioned policy manifest. */
export function isSourceIntegrationPolicyManifest(
  value: unknown,
): value is SourceIntegrationPolicyManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.mode === "unrestricted") {
    return hasExactKeys(value, ["schemaVersion", "mode"]);
  }
  if (
    value.mode !== "allowlist" ||
    !hasExactKeys(value, ["schemaVersion", "mode", "integrations"]) ||
    !isRecord(value.integrations)
  ) {
    return false;
  }

  return Object.entries(value.integrations).every(([integration, restriction]) => {
    if (
      !CANONICAL_INTEGRATION_TOOL_SEGMENT.test(integration) ||
      !isRecord(restriction) ||
      !hasExactKeys(restriction, ["allowedToolIds"])
    ) {
      return false;
    }

    if (restriction.allowedToolIds === null) return true;
    if (!Array.isArray(restriction.allowedToolIds)) return false;

    const toolIds = restriction.allowedToolIds;
    return toolIds.every((toolId) =>
      typeof toolId === "string" && CANONICAL_INTEGRATION_TOOL_SEGMENT.test(toolId)
    ) && new Set(toolIds).size === toolIds.length;
  });
}

function canonicalizeSourceIntegrationPolicyManifest(
  manifest: SourceIntegrationPolicyManifest,
): SourceIntegrationPolicyManifest {
  if (manifest.mode === "unrestricted") return UNRESTRICTED_SOURCE_INTEGRATION_POLICY;

  const integrations: Record<
    string,
    { allowedToolIds: readonly string[] | null }
  > = {};
  for (const integration of Object.keys(manifest.integrations).sort(compareStrings)) {
    const restriction = manifest.integrations[integration];
    if (!restriction) continue;
    const allowedToolIds = restriction.allowedToolIds === null
      ? null
      : Object.freeze([...restriction.allowedToolIds].sort(compareStrings));
    integrations[integration] = Object.freeze({ allowedToolIds });
  }

  return Object.freeze({
    schemaVersion: 1,
    mode: "allowlist",
    integrations: Object.freeze(integrations),
  });
}

/** Strictly parse and canonicalize a process-boundary policy manifest. */
export function parseSourceIntegrationPolicyManifest(
  value: unknown,
): SourceIntegrationPolicyManifest {
  if (!isSourceIntegrationPolicyManifest(value)) {
    throw new TypeError("Invalid source integration policy manifest");
  }
  return canonicalizeSourceIntegrationPolicyManifest(value);
}

/** Resolve an internal manifest; malformed state narrows to deny-all. */
export function resolveSourceIntegrationPolicyManifest(
  value: unknown,
): SourceIntegrationPolicyManifest | undefined {
  if (value === undefined) return undefined;
  return isSourceIntegrationPolicyManifest(value)
    ? canonicalizeSourceIntegrationPolicyManifest(value)
    : denyAllSourceIntegrationPolicy();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/** Build a deterministic manifest from validated `veryfront.config.ts` input. */
export function normalizeSourceIntegrationPolicy(
  config: SourceIntegrationPolicyConfig | undefined,
): SourceIntegrationPolicyManifest {
  if (!config) return UNRESTRICTED_SOURCE_INTEGRATION_POLICY;

  const integrations: Record<
    string,
    { allowedToolIds: readonly string[] | null }
  > = {};
  for (
    const [integration, restriction] of Object.entries(config.allow).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  ) {
    if (!restriction) continue;
    integrations[integration] = {
      allowedToolIds: restriction.allowedTools === undefined
        ? null
        : uniqueSorted(restriction.allowedTools),
    };
  }

  return canonicalizeSourceIntegrationPolicyManifest({
    schemaVersion: 1,
    mode: "allowlist",
    integrations,
  });
}

function intersectAllowedToolIds(
  left: readonly string[] | null,
  right: readonly string[] | null,
): readonly string[] | null {
  if (left === null) return right === null ? null : uniqueSorted(right);
  if (right === null) return uniqueSorted(left);

  const rightIds = new Set(right);
  return uniqueSorted(left.filter((toolId) => rightIds.has(toolId)));
}

/** Combine independent restrictions without allowing either one to widen access. */
export function intersectSourceIntegrationPolicies(
  left: SourceIntegrationPolicyManifest,
  right: SourceIntegrationPolicyManifest,
): SourceIntegrationPolicyManifest {
  if (left.mode === "unrestricted") return canonicalizeSourceIntegrationPolicyManifest(right);
  if (right.mode === "unrestricted") return canonicalizeSourceIntegrationPolicyManifest(left);

  const integrations: Record<
    string,
    { allowedToolIds: readonly string[] | null }
  > = {};
  for (const integration of Object.keys(left.integrations).sort(compareStrings)) {
    const leftRestriction = left.integrations[integration];
    const rightRestriction = right.integrations[integration];
    if (!leftRestriction || !rightRestriction) continue;
    integrations[integration] = {
      allowedToolIds: intersectAllowedToolIds(
        leftRestriction.allowedToolIds,
        rightRestriction.allowedToolIds,
      ),
    };
  }

  return canonicalizeSourceIntegrationPolicyManifest({
    schemaVersion: 1,
    mode: "allowlist",
    integrations,
  });
}

export interface IntegrationToolIdentity {
  integration: string;
  toolId: string;
}

function canonicalToolSegment(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    const allowed = code >= 97 && code <= 122 || code >= 48 && code <= 57 ||
      (index > 0 && (code === 45 || code === 95));
    if (!allowed) return false;
  }
  return true;
}

function stringIndex(
  operation: (this: string, search: string) => number,
  value: string,
  search: string,
): number {
  return apply(operation, value, [search]);
}

function slice(value: string, start: number, end?: number): string {
  return end === undefined
    ? apply(stringSlice, value, [start])
    : apply(stringSlice, value, [start, end]);
}

/**
 * Parse the canonical API tool name (`integration__tool_id`). Aliases and
 * alternate separators are intentionally not accepted at this policy layer.
 */
export function parseIntegrationToolIdentity(toolName: string): IntegrationToolIdentity | null {
  const separator = stringIndex(stringIndexOf, toolName, "__");
  if (
    separator <= 0 ||
    separator !== stringIndex(stringLastIndexOf, toolName, "__") ||
    separator + 2 >= toolName.length
  ) {
    return null;
  }

  const integration = slice(toolName, 0, separator);
  const toolId = slice(toolName, separator + 2);
  if (!canonicalToolSegment(integration) || !canonicalToolSegment(toolId)) return null;

  return {
    integration,
    toolId,
  };
}

/** Return whether a canonical integration tool survives the source restriction. */
export function isIntegrationToolAllowedBySourcePolicy(
  toolName: string,
  policy: SourceIntegrationPolicyManifest,
): boolean {
  if (policy.mode === "unrestricted") return true;

  const identity = parseIntegrationToolIdentity(toolName);
  if (!identity) return !toolName.includes("__");

  const restriction = policy.integrations[identity.integration];
  if (!restriction) return false;
  return restriction.allowedToolIds === null ||
    restriction.allowedToolIds.includes(identity.toolId);
}

/** Filter canonical tool names while leaving non-integration tools untouched. */
export function applySourceIntegrationPolicy(
  toolNames: readonly string[],
  policy: SourceIntegrationPolicyManifest,
): string[] {
  return toolNames.filter((toolName) => isIntegrationToolAllowedBySourcePolicy(toolName, policy));
}
