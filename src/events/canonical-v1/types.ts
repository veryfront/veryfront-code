/** Caller-authorized canonical-v1 read values. Legacy payloads remain opaque JSON. */
export type EventViewV1 = "public" | "diagnostic";
export interface CanonicalEventV1 {
  specversion: "1.0";
  vfversion: "1";
  id: string;
  source: string;
  type: string;
  subject?: string;
  runid?: string;
  recordedat?: string;
  datacontenttype: "application/json";
  dataschema: string;
  data: { type: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface RunReadMetadataV1 {
  event_id: number;
  run_id: string;
  storage: "persisted" | "derived";
  view: EventViewV1;
  recorded_at: string | null;
  event_class: "fact" | "delta" | null;
  is_error: boolean | null;
  span_id: string | null;
  turn_id: string | null;
  unrecoverable_fields: string[];
  origin?: unknown;
}
export interface CanonicalMemberV1 {
  kind: "canonical";
  event: CanonicalEventV1;
  metadata: RunReadMetadataV1 & { storage: "persisted"; recorded_at: string };
}
export type LegacyReasonV1 =
  | "unknown_type"
  | "reserved_type"
  | "blocked_type"
  | "unclassified_outcome"
  | "unclassified_request"
  | "unclassified_dispatch"
  | "malformed_payload"
  | "discriminator_conflict"
  | "unavailable_converter"
  | "derived_history"
  | "unprojectable_view";
export interface LegacyMemberV1 {
  kind: "legacy";
  reason: LegacyReasonV1;
  legacy: { event_type: string; payload: unknown };
  metadata: RunReadMetadataV1;
}
export interface TransientMemberV1 {
  kind: "transient";
  event: CanonicalEventV1;
  view: EventViewV1;
}
export type RunReadMemberV1 = CanonicalMemberV1 | LegacyMemberV1;
export type StreamMemberV1 =
  | CanonicalMemberV1
  | (LegacyMemberV1 & { metadata: RunReadMetadataV1 & { storage: "persisted" } })
  | TransientMemberV1;
export interface RunReadPageV1 {
  entries: RunReadMemberV1[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface EventDiscoveryV1 {
  version: "1";
  revision: string;
  events: {
    type: string;
    meaning: string;
    profile: "stored" | "live";
    schemas: { public: string; diagnostic: string | null };
  }[];
}

/** Additive cross-store descendant history profile; single-run pages remain unchanged. */
export interface DescendantRunReadPageV1 extends RunReadPageV1 {
  cursor_profile: "run-events-descendants-v1";
}
export interface DescendantCursorV1 {
  version: 1;
  root_run_id: string;
  producing_run_id: string;
  view: EventViewV1;
  sort_order: "asc" | "desc";
  filters_digest: string;
  event_id: string;
  store: "agent_run_event" | "run_execution_event";
}
