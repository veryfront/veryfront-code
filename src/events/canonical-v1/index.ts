/** Explicit canonical-v1 read contracts. Existing pilot event parsers are unchanged. */
export type {
  CanonicalEventV1,
  CanonicalMemberV1,
  DescendantCursorV1,
  DescendantRunReadPageV1,
  EventDiscoveryV1,
  EventViewV1,
  LegacyMemberV1,
  LegacyReasonV1,
  RunReadMemberV1,
  RunReadMetadataV1,
  RunReadPageV1,
  StreamMemberV1,
  TransientMemberV1,
} from "./types.ts";
import type {
  DescendantCursorV1,
  DescendantRunReadPageV1,
  EventDiscoveryV1,
  RunReadMemberV1,
  RunReadPageV1,
  StreamMemberV1,
} from "./types.ts";

// Existing Runs imports expose this facade without loading or normalizing its
// normative schema graph. The module is cached by the runtime after first use.
const loadParsers = () => import("./parser.ts");

/** Validate one canonical or authorized legacy history member. */
export async function parseRunReadMemberV1(input: unknown): Promise<RunReadMemberV1> {
  return (await loadParsers()).parseRunReadMemberV1(input);
}
/** Validate a durable or transient canonical stream member. */
export async function parseStreamMemberV1(input: unknown): Promise<StreamMemberV1> {
  return (await loadParsers()).parseStreamMemberV1(input);
}
/** Validate a canonical history page without dropping legacy members. */
export async function parseRunReadPageV1(input: unknown): Promise<RunReadPageV1> {
  return (await loadParsers()).parseRunReadPageV1(input);
}
/** Validate the canonical event discovery contract. */
export async function parseEventDiscoveryV1(input: unknown): Promise<EventDiscoveryV1> {
  return (await loadParsers()).parseEventDiscoveryV1(input);
}
/** Validate a content-free canonical protocol error. */
export async function parseEventErrorV1(
  input: unknown,
): Promise<{ code: string; message: string; event_ids?: number[] }> {
  return (await loadParsers()).parseEventErrorV1(input);
}

/** Validate an explicit cross-store descendant history page. */
export async function parseDescendantRunReadPageV1(
  input: unknown,
): Promise<DescendantRunReadPageV1> {
  return (await loadParsers()).parseDescendantRunReadPageV1(input);
}
/** Validate a bounded descendant token without replacing server scope authorization. */
export async function decodeDescendantCursorV1(input: string): Promise<DescendantCursorV1> {
  return (await loadParsers()).decodeDescendantCursorV1(input);
}
