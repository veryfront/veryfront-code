import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import type { CachedSourceObservation } from "#veryfront/platform/adapters/fs/cached-source-observation.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import { resolveRuntimeToolLoading } from "#veryfront/agent/runtime/runtime-tool-config.ts";
import { resolveToolResultContextLimits } from "#veryfront/agent/runtime/tool-result-context.ts";
import { encodePrivateText } from "#veryfront/security/private-text.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { privateByteLength } from "#veryfront/security/private-bytes.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";

export const SOURCE_SNAPSHOT_SSE_EVENT_NAME = "AgentRunSourceSnapshot";
export interface SourceObservationIdentity {
  projectId: string;
  branchId: string;
  canonicalRunId: string;
  publicRunId: string;
  agentId: string;
}
type SourceStages = {
  identity: SourceObservationIdentity;
  config: CachedSourceObservation;
  discovery: CachedSourceObservation;
};
const parseJson = JSON.parse;
const defineOwn = Object.defineProperty;
const getIdentitySchema = defineSchema((v) =>
  v.object({
    projectId: v.string().uuid(),
    branchId: v.string().uuid(),
    canonicalRunId: v.string().uuid(),
    publicRunId: v.string().min(1).max(256),
    agentId: v.string().min(1).max(256),
  }).strict()
);
const getSnapshotSchema = defineSchema((v) =>
  v.object({
    identity: v.string().min(1).max(2048),
    version: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    fingerprint: v.object({
      algorithm: v.literal("veryfront-source-snapshot-multiset-v1"),
      value: v.string().regex(/^[0-9a-f]{64}$/),
    }).strict(),
    members: v.array(
      v.object({ path: v.string().min(1).max(1024), sha256: v.string().regex(/^[0-9a-f]{64}$/) })
        .strict(),
    ).min(1).max(256),
  }).strict()
);
/** Invocation identity is an opaque WeakMap key, never a structural request property. */
type SourceObservationInvocation = object;

const stages = createPrivateWeakStore<SourceObservationInvocation, SourceStages>();
/** Called only by signed ingress after both concrete adapter captures. */
export function bindSourceObservationStages(
  input: SourceObservationInvocation,
  value: SourceStages,
): void {
  if (stages.get(input) !== undefined) return;
  // Retain own immutable values before project execution can mutate shared objects.
  const identity = getIdentitySchema().safeParse(parseJson(privateJsonStringify(value.identity)));
  const config = getSnapshotSchema().safeParse(parseJson(privateJsonStringify(value.config)));
  const discovery = getSnapshotSchema().safeParse(parseJson(privateJsonStringify(value.discovery)));
  if (identity.success && config.success && discovery.success) {
    stages.set(input, { identity: identity.data, config: config.data, discovery: discovery.data });
  }
}
/** Capture the effective selected configuration before dispatch, without request overrides. */
export function prepareSourceObservationFrames(
  input: SourceObservationInvocation,
  config: AgentConfig,
): readonly string[] {
  const captured = stages.get(input);
  if (!captured) return [];
  const first = captured.config, second = captured.discovery;
  if (
    privateJsonStringify(first.members) !== privateJsonStringify(second.members)
  ) {
    return [];
  }
  const resolvedConfig = {
    agentId: captured.identity.agentId,
    toolLoading: resolveRuntimeToolLoading(config).mode,
    toolResultContext: config.toolResultContext === true ||
        (typeof config.toolResultContext === "object" && config.toolResultContext !== null)
      ? resolveToolResultContextLimits(
        typeof config.toolResultContext === "object" ? config.toolResultContext : undefined,
      )
      : false,
  };
  const frames: string[] = [];
  for (let index = 0; index < 2; index++) {
    const encoded = privateJsonStringify({
      version: 1,
      identity: captured.identity,
      stage: index === 0 ? "config_loaded" : "discovery_completed",
      snapshot: index === 0 ? first : second,
      resolvedConfig: index === 0 ? null : resolvedConfig,
    });
    if (privateByteLength(encodePrivateText(encoded)) > 65536) return [];
    const descriptor = {
      __proto__: null,
      value: encoded,
      enumerable: true,
      configurable: true,
      writable: true,
    };
    defineOwn(frames, index, descriptor);
  }
  return frames;
}
