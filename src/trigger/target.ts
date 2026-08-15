import { isTriggerId } from "./validation.ts";

/** Hosted conversation behavior for an agent trigger target. */
export type AgentConversationMode = "create_new" | "existing" | "none";

/** Trigger target addressing a task definition. */
export interface TaskTriggerTarget extends TriggerTarget {
  /** Definition kind resolved by project runtime discovery. */
  kind: "task";
  /** Canonical slash-separated definition identifier. */
  id: string;
  /** Task targets do not carry hosted conversation behavior. */
  conversationMode?: never;
  /** Task targets do not carry hosted conversation identifiers. */
  conversationId?: never;
}

/** Trigger target addressing a workflow definition. */
export interface WorkflowTriggerTarget extends TriggerTarget {
  /** Definition kind resolved by project runtime discovery. */
  kind: "workflow";
  /** Canonical slash-separated definition identifier. */
  id: string;
  /** Workflow targets do not carry hosted conversation behavior. */
  conversationMode?: never;
  /** Workflow targets do not carry hosted conversation identifiers. */
  conversationId?: never;
}

/** Trigger target addressing an agent definition and its hosted conversation. */
export interface AgentTriggerTarget extends TriggerTarget {
  /** Definition kind resolved by project runtime discovery. */
  kind: "agent";
  /** Canonical slash-separated definition identifier. */
  id: string;
  /** Hosted conversation behavior; defaults to `none`. */
  conversationMode?: AgentConversationMode | undefined;
  /** Existing conversation UUID; required only with `conversationMode: "existing"`. */
  conversationId?: string | null | undefined;
}

/** Canonical reference to a runnable project definition. */
export interface TriggerTarget {
  /** Definition kind resolved by project runtime discovery. */
  kind: "task" | "workflow" | "agent";
  /** Canonical slash-separated definition identifier. */
  id: string;
}

/** Author-facing target shape accepting stored base values and kind-specific literals. */
export type TriggerTargetConfig =
  | (TriggerTarget & {
    conversationMode?: never;
    conversationId?: never;
  })
  | TaskTriggerTarget
  | WorkflowTriggerTarget
  | AgentTriggerTarget;

/** Validated target value that narrows conversation fields by `kind`. */
export type ResolvedTriggerTarget =
  | TaskTriggerTarget
  | WorkflowTriggerTarget
  | AgentTriggerTarget;

/** Supported local trigger target kinds. */
export type TriggerTargetKind = TriggerTarget["kind"];

const AGENT_CONVERSATION_MODES = new Set<AgentConversationMode>([
  "create_new",
  "existing",
  "none",
]);
const CONVERSATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DIAGNOSTIC_KEY_LENGTH = 80;
const SIMPLE_DIAGNOSTIC_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;
const TARGET_KEYS = ["kind", "id"] as const;
const AGENT_TARGET_KEYS = [
  "kind",
  "id",
  "conversationMode",
  "conversationId",
] as const;

function readOwnDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function readOwnKind(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return readOwnDataProperty(value, "kind");
  } catch {
    return undefined;
  }
}

/**
 * Own keys a trigger target may declare, widened for agent targets.
 *
 * The kind is read as an own data property so an author-defined accessor never
 * runs while the allowed key set is selected.
 */
export function triggerTargetKeys(value: unknown): readonly string[] {
  return readOwnKind(value) === "agent" ? AGENT_TARGET_KEYS : TARGET_KEYS;
}

/**
 * Describe why agent conversation addressing is invalid, or return `null`.
 *
 * `label` prefixes the diagnostic so schedules, webhooks, and targets report
 * the same invariant with their own field path.
 */
export function agentConversationDiagnostic(
  label: string,
  conversationMode: unknown,
  conversationId: unknown,
): string | null {
  if (
    conversationMode !== undefined &&
    !AGENT_CONVERSATION_MODES.has(conversationMode as AgentConversationMode)
  ) {
    return `${label}.conversationMode must be create_new, existing, or none.`;
  }
  if (
    conversationId !== undefined && conversationId !== null &&
    (typeof conversationId !== "string" ||
      !CONVERSATION_ID_PATTERN.test(conversationId))
  ) {
    return `${label}.conversationId must be a UUID or null.`;
  }

  const effectiveMode = conversationMode ?? "none";
  if (effectiveMode === "existing" && typeof conversationId !== "string") {
    return `${label}.conversationId is required when conversationMode is existing.`;
  }
  if (effectiveMode !== "existing" && typeof conversationId === "string") {
    return `${label}.conversationId is allowed only when conversationMode is existing.`;
  }
  return null;
}

/**
 * Describe one value declared in two places with disagreeing content.
 *
 * Repeating a value is redundant, not wrong: an author spanning a platform
 * upgrade must be able to write a single definition that both the old and the
 * new platform read correctly. Only a disagreement is unresolvable, because
 * honoring one copy would detach the deployed trigger from what the other copy
 * names.
 */
export function declarationConflictDiagnostic(
  label: string,
  path: string,
  legacyPath: string,
  value: unknown,
  legacyValue: unknown,
): string | null {
  if (value === undefined || legacyValue === undefined) return null;
  if (value === legacyValue) return null;
  return `${label} ${path} and ${legacyPath} are both set to different values. Declare it in one place.`;
}

/**
 * Describe a conversation pair that disagrees across two locations.
 *
 * `legacyLabel` names the other location so the message spells out both real
 * field paths without ranking them: which one a given platform reads depends
 * on its version, so neither can be called authoritative here.
 */
export function conversationConflictDiagnostic(
  label: string,
  legacyLabel: string,
  target: ResolvedTriggerTarget,
  legacyConversationMode: unknown,
  legacyConversationId: unknown,
): string | null {
  if (target.kind !== "agent") return null;
  for (
    const [field, targetValue, legacyValue] of [
      ["conversationMode", target.conversationMode, legacyConversationMode],
      ["conversationId", target.conversationId, legacyConversationId],
    ] as const
  ) {
    const detail = declarationConflictDiagnostic(
      label,
      `target.${field}`,
      `${legacyLabel}.${field}`,
      targetValue,
      legacyValue,
    );
    if (detail !== null) return detail;
  }
  return null;
}

function truncateDiagnosticKey(key: string): string {
  if (key.length <= MAX_DIAGNOSTIC_KEY_LENGTH) return key;
  let prefix = key.slice(0, MAX_DIAGNOSTIC_KEY_LENGTH);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix}…`;
}

function formatDiagnosticProperty(label: string, key: string): string {
  const boundedKey = truncateDiagnosticKey(key);
  return SIMPLE_DIAGNOSTIC_KEY_PATTERN.test(boundedKey)
    ? `${label}.${boundedKey}`
    : `${label}[${JSON.stringify(boundedKey)}]`;
}

/** A canonical target, or the reason the value is not one. */
export type TriggerTargetResolution =
  | { readonly target: ResolvedTriggerTarget; readonly detail?: undefined }
  | { readonly target?: undefined; readonly detail: string };

function requireOwnDataField(
  label: string,
  value: object,
  key: "conversationMode" | "conversationId",
): TriggerTargetResolution | null {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || "value" in descriptor) return null;
  return {
    detail: `${formatDiagnosticProperty(label, key)} must be an own data property.`,
  };
}

/**
 * Validate and copy the canonical fields of a trigger target.
 *
 * Public `TriggerTarget` interfaces are intentionally extendable, so this
 * generic helper ignores caller-owned extension fields. Schedule and webhook
 * authoring validators apply strict key checks before calling this helper.
 */
export function resolveTriggerTarget(
  label: string,
  value: unknown,
): TriggerTargetResolution {
  const notATarget = {
    detail: `${label} must specify a canonical task, workflow, or agent id.`,
  } as const;
  if (typeof value !== "object" || value === null) return notATarget;

  try {
    const kind = readOwnDataProperty(value, "kind");
    const id = readOwnDataProperty(value, "id");
    if (
      (kind !== "task" && kind !== "workflow" && kind !== "agent") ||
      !isTriggerId(id)
    ) {
      return notATarget;
    }

    const conversationModeField = requireOwnDataField(label, value, "conversationMode");
    if (conversationModeField !== null) return conversationModeField;
    const conversationIdField = requireOwnDataField(label, value, "conversationId");
    if (conversationIdField !== null) return conversationIdField;

    const conversationMode = readOwnDataProperty(value, "conversationMode");
    const conversationId = readOwnDataProperty(value, "conversationId");
    if (kind !== "agent") {
      if (conversationMode !== undefined) {
        return { detail: `${label}.conversationMode is supported only for agent targets.` };
      }
      if (conversationId !== undefined) {
        return { detail: `${label}.conversationId is supported only for agent targets.` };
      }
      return { target: { kind, id } };
    }

    const conversationDetail = agentConversationDiagnostic(
      label,
      conversationMode,
      conversationId,
    );
    if (conversationDetail !== null) return { detail: conversationDetail };
    return {
      target: {
        kind,
        id,
        ...(conversationMode === undefined
          ? {}
          : { conversationMode: conversationMode as AgentConversationMode }),
        ...(conversationId === undefined
          ? {}
          : { conversationId: conversationId as string | null }),
      },
    };
  } catch {
    return notATarget;
  }
}

/**
 * Validate and copy a trigger target without retaining caller-owned state.
 */
export function snapshotTriggerTarget(value: unknown): ResolvedTriggerTarget | null {
  return resolveTriggerTarget("Trigger target", value).target ?? null;
}

/** Return true only for canonical targets stored in own data properties. */
export function isTriggerTarget(value: unknown): value is ResolvedTriggerTarget {
  return snapshotTriggerTarget(value) !== null;
}
