import type { IntegrationJsonObject } from "./client-types.ts";

/** Metadata-only selected-tool evidence. Provider authorization is never implied. */
export interface IntegrationSelectedReadiness extends IntegrationJsonObject {
  version: 1;
  selection: IntegrationJsonObject & {
    project_id: string;
    integration: string;
    tool_name: string;
    requested_connection_id: string | null;
    state: "selected" | "missing" | "ambiguous" | "unavailable" | "stale" | "unknown";
    mode: "oauth_connection" | "project_credentials" | "service_identity" | "mock" | "unknown";
    scope: "user" | "project" | null;
    connection_id: string | null;
    connection_generation_id: string | null;
  };
  connection: IntegrationJsonObject & { state: string };
  account: IntegrationJsonObject & {
    state: "recorded" | "unknown";
    id: string | null;
    display_name: string | null;
    evidence: "stored_metadata" | "none";
  };
  credentials: IntegrationJsonObject & { evidence: string; missing_keys: string[] };
  local_eligibility: IntegrationJsonObject & {
    state: "eligible" | "blocked" | "unknown";
    basis: "metadata_only";
    required_capability: string;
    blockers: string[];
    pending_checks: string[];
  };
  provider_verification: IntegrationJsonObject & { state: "not_checked" };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oneOf(value: unknown, values: readonly unknown[]): boolean {
  return values.includes(value);
}
function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function nullableUuid(value: unknown): boolean {
  return value === null ||
    (typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

function sameUuid(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

/** Validate a bounded response against the exact caller selection before exposing it. */
export function isSelectedReadiness(value: unknown, expected: {
  projectId: string;
  integration: string;
  toolName: string;
  connectionId?: string;
  generation?: string;
}): value is IntegrationSelectedReadiness {
  if (!object(value) || value.version !== 1) return false;
  const {
    selection: s,
    connection: c,
    account: a,
    credentials: k,
    local_eligibility: l,
    provider_verification: p,
  } = value;
  if (!object(s) || !object(c) || !object(a) || !object(k) || !object(l) || !object(p)) {
    return false;
  }
  if (
    !sameUuid(s.project_id, expected.projectId) || s.integration !== expected.integration ||
    s.tool_name !== expected.toolName ||
    (expected.connectionId
      ? !sameUuid(s.requested_connection_id, expected.connectionId)
      : s.requested_connection_id !== null)
  ) return false;
  if (
    !oneOf(s.state, ["selected", "missing", "ambiguous", "unavailable", "stale", "unknown"]) ||
    !oneOf(s.mode, [
      "oauth_connection",
      "project_credentials",
      "service_identity",
      "mock",
      "unknown",
    ]) ||
    !oneOf(s.scope, ["user", "project", null]) || !nullableUuid(s.connection_id) ||
    !nullableUuid(s.connection_generation_id)
  ) return false;
  if (
    expected.connectionId && s.connection_id !== null &&
    !sameUuid(s.connection_id, expected.connectionId)
  ) return false;
  if (
    expected.generation && s.state === "selected" &&
    !sameUuid(s.connection_generation_id, expected.generation)
  ) return false;
  if (
    s.state === "selected" && s.mode === "oauth_connection" &&
    (s.connection_id === null || s.connection_generation_id === null || s.scope === null)
  ) return false;
  if (
    a.state === "unknown" && (a.id !== null || a.display_name !== null || a.evidence !== "none")
  ) return false;
  if (a.state === "recorded" && (a.evidence !== "stored_metadata" || s.scope !== "project")) {
    return false;
  }
  if (
    s.state === "stale" &&
    (l.state !== "blocked" || !strings(l.blockers) || !l.blockers.includes("connection_stale"))
  ) return false;
  if (l.state === "eligible" && (!strings(l.blockers) || l.blockers.length > 0)) return false;
  return oneOf(c.state, [
    "connected",
    "expired",
    "disconnected",
    "revoked",
    "missing",
    "unknown",
    "not_applicable",
  ]) &&
    oneOf(a.state, ["recorded", "unknown"]) && nullableString(a.id) &&
    nullableString(a.display_name) && oneOf(a.evidence, ["stored_metadata", "none"]) &&
    oneOf(k.evidence, [
      "connection_metadata",
      "complete_key_presence",
      "partial_key_presence",
      "absent",
      "not_applicable",
    ]) && strings(k.missing_keys) &&
    oneOf(l.state, ["eligible", "blocked", "unknown"]) && l.basis === "metadata_only" &&
    oneOf(l.required_capability, ["project.integrations.read", "project.integrations.connect"]) &&
    strings(l.blockers) && strings(l.pending_checks) && p.state === "not_checked";
}
