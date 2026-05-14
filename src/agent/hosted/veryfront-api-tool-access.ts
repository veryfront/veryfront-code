import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";

export type VeryfrontApiToolAccessVisibility = "visible" | "hidden";
export type VeryfrontApiToolAccessFamily = "collaboration" | "runtime" | "domains" | "export";
export type VeryfrontApiToolAccessAction =
  | "create_invite"
  | "delete_member"
  | "create_server"
  | "delete_server"
  | "create_domain"
  | "download_release";

export type VeryfrontApiToolAccessDecision = {
  visibility: VeryfrontApiToolAccessVisibility;
  reasonCode: string;
};

export type VeryfrontApiToolAccessActionOverride = {
  action: VeryfrontApiToolAccessAction;
  decision: VeryfrontApiToolAccessDecision;
};

export type VeryfrontApiToolAccessFamilyProfile = {
  family: VeryfrontApiToolAccessFamily;
  defaultDecision: VeryfrontApiToolAccessDecision;
  actionOverrides: VeryfrontApiToolAccessActionOverride[];
};

export type VeryfrontApiToolAccessProfile = {
  version: 1;
  freshness: {
    resolvedAt: string;
    validForMs: number;
    failClosedOnExpiry: true;
  };
  families: VeryfrontApiToolAccessFamilyProfile[];
};

type VeryfrontApiToolAccessRule = {
  family: VeryfrontApiToolAccessFamily;
  action: VeryfrontApiToolAccessAction;
};

type FilterMode = "open" | "closed";

const TOOL_ACCESS_PROFILE_TOOL_NAME = "get_tool_access_profile";

const toolAccessRules = new Map<string, VeryfrontApiToolAccessRule>([
  ["create_invite", { family: "collaboration", action: "create_invite" }],
  ["delete_member", { family: "collaboration", action: "delete_member" }],
  ["create_server", { family: "runtime", action: "create_server" }],
  ["delete_server", { family: "runtime", action: "delete_server" }],
  ["create_domain", { family: "domains", action: "create_domain" }],
  ["download_release", { family: "export", action: "download_release" }],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getStringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getNumberProperty(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseVisibility(value: string | null): VeryfrontApiToolAccessVisibility | null {
  return value === "visible" || value === "hidden" ? value : null;
}

function parseFamily(value: string | null): VeryfrontApiToolAccessFamily | null {
  return value === "collaboration" || value === "runtime" || value === "domains" ||
      value === "export"
    ? value
    : null;
}

function parseAction(value: string | null): VeryfrontApiToolAccessAction | null {
  return value === "create_invite" || value === "delete_member" ||
      value === "create_server" || value === "delete_server" || value === "create_domain" ||
      value === "download_release"
    ? value
    : null;
}

function parseDecision(value: unknown): VeryfrontApiToolAccessDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const visibility = parseVisibility(getStringProperty(value, "visibility"));
  const reasonCode = getStringProperty(value, "reason_code");
  if (!visibility || !reasonCode) {
    return null;
  }

  return { visibility, reasonCode };
}

function parseActionOverride(value: unknown): VeryfrontApiToolAccessActionOverride | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = parseAction(getStringProperty(value, "action"));
  const decision = parseDecision(value.decision);
  if (!action || !decision) {
    return null;
  }

  return { action, decision };
}

function parseActionOverrides(value: unknown): VeryfrontApiToolAccessActionOverride[] | null {
  if (!Array.isArray(value)) {
    return [];
  }

  const overrides: VeryfrontApiToolAccessActionOverride[] = [];
  for (const entry of value) {
    const override = parseActionOverride(entry);
    if (!override) {
      return null;
    }
    overrides.push(override);
  }
  return overrides;
}

function parseFamilyProfile(value: unknown): VeryfrontApiToolAccessFamilyProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const family = parseFamily(getStringProperty(value, "family"));
  const defaultDecision = parseDecision(value.default_decision);
  const actionOverrides = parseActionOverrides(value.action_overrides);
  if (!family || !defaultDecision || !actionOverrides) {
    return null;
  }

  return {
    family,
    defaultDecision,
    actionOverrides,
  };
}

function parseFamilies(value: unknown): VeryfrontApiToolAccessFamilyProfile[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const families: VeryfrontApiToolAccessFamilyProfile[] = [];
  for (const entry of value) {
    const family = parseFamilyProfile(entry);
    if (!family) {
      return null;
    }
    families.push(family);
  }
  return families;
}

export function parseVeryfrontApiToolAccessProfile(
  value: unknown,
): VeryfrontApiToolAccessProfile | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.freshness)) {
    return null;
  }

  const resolvedAt = getStringProperty(value.freshness, "resolved_at");
  const validForMs = getNumberProperty(value.freshness, "valid_for_ms");
  const failClosedOnExpiry = value.freshness.fail_closed_on_expiry;
  const families = parseFamilies(value.families);
  if (!resolvedAt || validForMs === null || failClosedOnExpiry !== true || !families) {
    return null;
  }

  return {
    version: 1,
    freshness: {
      resolvedAt,
      validForMs,
      failClosedOnExpiry,
    },
    families,
  };
}

export function isVeryfrontApiToolAccessProfileFresh(
  profile: VeryfrontApiToolAccessProfile,
  nowMs = Date.now(),
): boolean {
  const resolvedAtMs = Date.parse(profile.freshness.resolvedAt);
  if (!Number.isFinite(resolvedAtMs)) {
    return false;
  }

  return nowMs <= resolvedAtMs + profile.freshness.validForMs;
}

function getToolAccessDecision(
  profile: VeryfrontApiToolAccessProfile,
  rule: VeryfrontApiToolAccessRule,
): VeryfrontApiToolAccessDecision | null {
  const family = profile.families.find((candidate) => candidate.family === rule.family);
  if (!family) {
    return null;
  }

  return family.actionOverrides.find((override) => override.action === rule.action)?.decision ??
    family.defaultDecision;
}

export function shouldExposeVeryfrontApiTool(
  profile: VeryfrontApiToolAccessProfile | null,
  toolName: string,
  mode: FilterMode = "open",
): boolean {
  const rule = toolAccessRules.get(toolName);
  if (!rule) {
    return true;
  }

  if (!profile) {
    return mode === "open";
  }

  const decision = getToolAccessDecision(profile, rule);
  return decision?.visibility === "visible";
}

export function filterVeryfrontApiToolDefinitionsByAccessProfile(input: {
  toolDefinitions: readonly ToolDefinition[];
  profile: VeryfrontApiToolAccessProfile | null;
  mode?: FilterMode;
}): ToolDefinition[] {
  return input.toolDefinitions.filter((toolDefinition) =>
    shouldExposeVeryfrontApiTool(input.profile, toolDefinition.name, input.mode ?? "open")
  );
}

export async function fetchVeryfrontApiToolAccessProfile(input: {
  source: RemoteToolSource;
  projectId: string;
  context?: ToolExecutionContext;
}): Promise<VeryfrontApiToolAccessProfile | null> {
  const rawProfile = await input.source.executeTool(
    TOOL_ACCESS_PROFILE_TOOL_NAME,
    { project_reference: input.projectId },
    input.context,
  );
  return parseVeryfrontApiToolAccessProfile(rawProfile);
}

export async function filterVeryfrontApiToolDefinitionsWithAccessProfile(input: {
  source: RemoteToolSource;
  toolDefinitions: readonly ToolDefinition[];
  projectId: string | null;
  context?: ToolExecutionContext;
  nowMs?: number;
}): Promise<ToolDefinition[]> {
  if (!input.projectId) {
    return [...input.toolDefinitions];
  }

  try {
    const profile = await fetchVeryfrontApiToolAccessProfile({
      source: input.source,
      projectId: input.projectId,
      context: input.context,
    });
    if (profile && isVeryfrontApiToolAccessProfileFresh(profile, input.nowMs)) {
      return filterVeryfrontApiToolDefinitionsByAccessProfile({
        toolDefinitions: input.toolDefinitions,
        profile,
      });
    }
  } catch {
    // Fall through to fail-closed visibility for mapped API-owned tools.
  }

  return filterVeryfrontApiToolDefinitionsByAccessProfile({
    toolDefinitions: input.toolDefinitions,
    profile: null,
    mode: "closed",
  });
}
