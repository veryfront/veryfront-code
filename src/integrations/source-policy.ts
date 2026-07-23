/**
 * Source-owned integration restrictions.
 *
 * This policy is deliberately monotonic: it can only remove integrations or
 * tools from the capabilities already granted by the agent source, catalog,
 * and control-plane policy. It never enables an integration, selects a
 * credential scope, or grants access on its own.
 */

import { ALL_INTEGRATION_NAMES, type IntegrationName } from "./schema.ts";

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

const MAX_POLICY_TOOL_IDS = 512;
const MAX_POLICY_SEGMENT_LENGTH = 128;
const MAX_INTEGRATION_TOOL_NAME_LENGTH = MAX_POLICY_SEGMENT_LENGTH * 2 + 2;
const canonicalPolicies = new WeakSet<object>();
const knownIntegrationNames = new Set<string>(ALL_INTEGRATION_NAMES);
const MAX_POLICY_INTEGRATIONS = knownIntegrationNames.size;

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY: SourceIntegrationPolicyManifest = Object.freeze({
  schemaVersion: 1,
  mode: "unrestricted",
});

const DENY_ALL_SOURCE_INTEGRATION_POLICY: SourceIntegrationPolicyManifest = Object.freeze({
  schemaVersion: 1,
  mode: "allowlist",
  integrations: Object.freeze({}),
});

canonicalPolicies.add(UNRESTRICTED_SOURCE_INTEGRATION_POLICY);
canonicalPolicies.add(DENY_ALL_SOURCE_INTEGRATION_POLICY);

function denyAllSourceIntegrationPolicy(): SourceIntegrationPolicyManifest {
  return DENY_ALL_SOURCE_INTEGRATION_POLICY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return false;
  const actualKeys = (ownKeys as string[]).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

const CANONICAL_INTEGRATION_TOOL_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

function isCanonicalSegment(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_POLICY_SEGMENT_LENGTH &&
    CANONICAL_INTEGRATION_TOOL_SEGMENT.test(value);
}

function markCanonical<T extends SourceIntegrationPolicyManifest>(manifest: T): T {
  canonicalPolicies.add(manifest);
  return manifest;
}

function tryCanonicalizeSourceIntegrationPolicyManifest(
  value: unknown,
): SourceIntegrationPolicyManifest | undefined {
  try {
    if (!isRecord(value)) return undefined;
    if (canonicalPolicies.has(value)) return value as unknown as SourceIntegrationPolicyManifest;
    const schemaVersion = value.schemaVersion;
    const mode = value.mode;
    if (
      !hasExactKeys(
        value,
        mode === "unrestricted"
          ? ["schemaVersion", "mode"]
          : ["schemaVersion", "mode", "integrations"],
      )
    ) {
      return undefined;
    }

    if (schemaVersion !== 1) return undefined;
    if (mode === "unrestricted") return UNRESTRICTED_SOURCE_INTEGRATION_POLICY;
    if (mode !== "allowlist") return undefined;

    const rawIntegrations = value.integrations;
    if (!isRecord(rawIntegrations)) return undefined;
    const integrationKeys = Reflect.ownKeys(rawIntegrations);
    if (
      integrationKeys.length > MAX_POLICY_INTEGRATIONS ||
      integrationKeys.some((key) =>
        typeof key !== "string" ||
        !isCanonicalSegment(key) ||
        !knownIntegrationNames.has(key)
      )
    ) {
      return undefined;
    }

    const integrations: Record<string, { allowedToolIds: readonly string[] | null }> = {};
    for (const integration of (integrationKeys as string[]).sort()) {
      const restriction = rawIntegrations[integration];
      if (!isRecord(restriction) || !hasExactKeys(restriction, ["allowedToolIds"])) {
        return undefined;
      }

      const rawToolIds = restriction.allowedToolIds;
      if (rawToolIds === null) {
        integrations[integration] = Object.freeze({ allowedToolIds: null });
        continue;
      }
      if (!Array.isArray(rawToolIds) || rawToolIds.length > MAX_POLICY_TOOL_IDS) {
        return undefined;
      }

      const toolIds: string[] = [];
      const uniqueToolIds = new Set<string>();
      for (const toolId of rawToolIds) {
        if (!isCanonicalSegment(toolId) || uniqueToolIds.has(toolId)) return undefined;
        uniqueToolIds.add(toolId);
        toolIds.push(toolId);
      }
      toolIds.sort();
      integrations[integration] = Object.freeze({
        allowedToolIds: Object.freeze(toolIds),
      });
    }

    return markCanonical(Object.freeze({
      schemaVersion: 1,
      mode: "allowlist",
      integrations: Object.freeze(integrations),
    }));
  } catch {
    return undefined;
  }
}

/** Return whether a process-boundary value is an exact versioned policy manifest. */
export function isSourceIntegrationPolicyManifest(
  value: unknown,
): value is SourceIntegrationPolicyManifest {
  return tryCanonicalizeSourceIntegrationPolicyManifest(value) !== undefined;
}

/** Strictly parse and canonicalize a process-boundary policy manifest. */
export function parseSourceIntegrationPolicyManifest(
  value: unknown,
): SourceIntegrationPolicyManifest {
  const manifest = tryCanonicalizeSourceIntegrationPolicyManifest(value);
  if (!manifest) {
    throw new TypeError("Invalid source integration policy manifest");
  }
  return manifest;
}

/** Resolve an internal manifest; malformed state narrows to deny-all. */
export function resolveSourceIntegrationPolicyManifest(
  value: unknown,
): SourceIntegrationPolicyManifest | undefined {
  if (value === undefined) return undefined;
  return tryCanonicalizeSourceIntegrationPolicyManifest(value) ?? denyAllSourceIntegrationPolicy();
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Build a deterministic manifest from validated `veryfront.config.ts` input. */
export function normalizeSourceIntegrationPolicy(
  config: SourceIntegrationPolicyConfig | undefined,
): SourceIntegrationPolicyManifest {
  if (config === undefined) return UNRESTRICTED_SOURCE_INTEGRATION_POLICY;
  try {
    if (!isRecord(config) || !hasExactKeys(config, ["allow"])) {
      throw new TypeError();
    }
    const rawAllow = config.allow;
    if (!isRecord(rawAllow)) throw new TypeError();
    const allowKeys = Reflect.ownKeys(rawAllow);
    if (
      allowKeys.length > MAX_POLICY_INTEGRATIONS ||
      allowKeys.some((key) => typeof key !== "string")
    ) {
      throw new TypeError();
    }

    const integrations: Record<string, { allowedToolIds: readonly string[] | null }> = {};
    for (const integration of (allowKeys as string[]).sort()) {
      const restriction: unknown = Reflect.get(rawAllow, integration);
      if (!knownIntegrationNames.has(integration)) throw new TypeError();
      if (restriction === undefined) continue;
      if (
        !isRecord(restriction) ||
        !hasExactKeys(
          restriction,
          Object.hasOwn(restriction, "allowedTools") ? ["allowedTools"] : [],
        )
      ) {
        throw new TypeError();
      }
      const rawToolIds = restriction.allowedTools;
      if (rawToolIds === undefined) {
        integrations[integration] = { allowedToolIds: null };
        continue;
      }
      if (!Array.isArray(rawToolIds) || rawToolIds.length > MAX_POLICY_TOOL_IDS) {
        throw new TypeError();
      }
      if (!rawToolIds.every(isCanonicalSegment)) throw new TypeError();
      integrations[integration] = { allowedToolIds: uniqueSorted(rawToolIds) };
    }

    const manifest = tryCanonicalizeSourceIntegrationPolicyManifest({
      schemaVersion: 1,
      mode: "allowlist",
      integrations,
    });
    if (!manifest) throw new TypeError();
    return manifest;
  } catch {
    throw new TypeError("Invalid source integration policy config");
  }
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
  const canonicalLeft = resolveSourceIntegrationPolicyManifest(left) ??
    denyAllSourceIntegrationPolicy();
  const canonicalRight = resolveSourceIntegrationPolicyManifest(right) ??
    denyAllSourceIntegrationPolicy();
  if (canonicalLeft.mode === "unrestricted") return canonicalRight;
  if (canonicalRight.mode === "unrestricted") return canonicalLeft;

  const integrations: Record<
    string,
    { allowedToolIds: readonly string[] | null }
  > = {};
  for (const integration of Object.keys(canonicalLeft.integrations).sort()) {
    const leftRestriction = canonicalLeft.integrations[integration];
    const rightRestriction = canonicalRight.integrations[integration];
    if (!leftRestriction || !rightRestriction) continue;
    integrations[integration] = {
      allowedToolIds: intersectAllowedToolIds(
        leftRestriction.allowedToolIds,
        rightRestriction.allowedToolIds,
      ),
    };
  }

  return parseSourceIntegrationPolicyManifest({
    schemaVersion: 1,
    mode: "allowlist",
    integrations,
  });
}

export interface IntegrationToolIdentity {
  integration: string;
  toolId: string;
}

/**
 * Parse the canonical API tool name (`integration__tool_id`). Aliases and
 * alternate separators are intentionally not accepted at this policy layer.
 */
export function parseIntegrationToolIdentity(toolName: string): IntegrationToolIdentity | null {
  if (typeof toolName !== "string" || toolName.length > MAX_INTEGRATION_TOOL_NAME_LENGTH) {
    return null;
  }
  const separator = toolName.indexOf("__");
  if (
    separator <= 0 ||
    separator !== toolName.lastIndexOf("__") ||
    separator + 2 >= toolName.length ||
    !isCanonicalSegment(toolName.slice(0, separator)) ||
    !isCanonicalSegment(toolName.slice(separator + 2))
  ) {
    return null;
  }

  return {
    integration: toolName.slice(0, separator),
    toolId: toolName.slice(separator + 2),
  };
}

/** Return whether a canonical integration tool survives the source restriction. */
export function isIntegrationToolAllowedBySourcePolicy(
  toolName: string,
  policy: SourceIntegrationPolicyManifest,
): boolean {
  if (typeof toolName !== "string") return false;
  const canonicalPolicy = resolveSourceIntegrationPolicyManifest(policy) ??
    denyAllSourceIntegrationPolicy();
  if (canonicalPolicy.mode === "unrestricted") return true;

  const identity = parseIntegrationToolIdentity(toolName);
  if (!identity) return !toolName.includes("__");

  const restriction = Object.hasOwn(canonicalPolicy.integrations, identity.integration)
    ? canonicalPolicy.integrations[identity.integration]
    : undefined;
  if (!restriction) return false;
  return restriction.allowedToolIds === null ||
    restriction.allowedToolIds.includes(identity.toolId);
}

/** Filter canonical tool names while leaving non-integration tools untouched. */
export function applySourceIntegrationPolicy(
  toolNames: readonly string[],
  policy: SourceIntegrationPolicyManifest,
): string[] {
  const canonicalPolicy = resolveSourceIntegrationPolicyManifest(policy) ??
    denyAllSourceIntegrationPolicy();
  return toolNames.filter((toolName) =>
    isIntegrationToolAllowedBySourcePolicy(toolName, canonicalPolicy)
  );
}
