import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  bindSourceObservationStages,
  prepareSourceObservationFrames,
} from "./source-observation.ts";
import type { CachedSourceObservation } from "#veryfront/platform/adapters/fs/cached-source-observation.ts";

const identity = {
  projectId: "10000000-1000-4000-8000-100000000001",
  branchId: "10000000-1000-4000-8000-100000000002",
  canonicalRunId: "10000000-1000-4000-8000-100000000003",
  publicRunId: "run_test",
  agentId: "orchestrator-agent",
};
function snapshot(version = 1): CachedSourceObservation {
  return {
    identity: "branch:test:sample",
    version,
    fingerprint: { algorithm: "veryfront-source-snapshot-multiset-v1", value: "a".repeat(64) },
    members: Array.from(
      { length: 46 },
      (_, i) => ({ path: `source-${String(i).padStart(2, "0")}.ts`, sha256: "b".repeat(64) }),
    ),
  };
}
describe("private source observations", () => {
  it("requires a private input binding rather than caller properties", () => {
    assertEquals(
      prepareSourceObservationFrames({ sourceObservation: snapshot() }, { system: "Test." }),
      [],
    );
  });
  it("retains all 46 members and resolves the actual selected baseline configuration", () => {
    const input = {};
    bindSourceObservationStages(input, { identity, config: snapshot(), discovery: snapshot(4) });
    const frames = prepareSourceObservationFrames(input, {
      system: "Test.",
      toolLoading: "eager",
      toolResultContext: false,
    }).map((frame) => JSON.parse(frame));
    assertEquals(frames.map((f) => f.stage), ["config_loaded", "discovery_completed"]);
    assertEquals(frames[0].snapshot.members.length, 46);
    assertEquals(frames[0].snapshot.version, 1);
    assertEquals(frames[1].snapshot.version, 4);
    assertEquals(frames[1].resolvedConfig, {
      agentId: identity.agentId,
      toolLoading: "eager",
      toolResultContext: false,
    });
  });
  it("reuses actual effective loading and result defaults including host overrides", () => {
    const input = {};
    bindSourceObservationStages(input, { identity, config: snapshot(), discovery: snapshot() });
    const frames = prepareSourceObservationFrames(input, {
      system: "Test.",
      toolLoading: "deferred",
      toolResultContext: { maxInlineBytes: 1024, previewBytes: 256, maxSectionBytes: 65536 },
    }).map((frame) => JSON.parse(frame));
    assertEquals(frames[1].resolvedConfig, {
      agentId: identity.agentId,
      toolLoading: "deferred",
      toolResultContext: {
        maxInlineBytes: 1024,
        previewBytes: 256,
        maxSectionBytes: 65536,
        maxStoredResults: 256,
      },
    });
    const hostConfig = {
      system: "Test.",
      toolLoading: "deferred" as const,
      deniedTools: ["tool_search"],
    };
    assertEquals(
      JSON.parse(prepareSourceObservationFrames(input, hostConfig)[1]!).resolvedConfig.toolLoading,
      "eager",
    );
  });
  it("rejects a change to an extension member despite unchanged required files", () => {
    const input = {}, changed = snapshot();
    changed.members[45]!.sha256 = "c".repeat(64);
    bindSourceObservationStages(input, { identity, config: snapshot(), discovery: changed });
    assertEquals(prepareSourceObservationFrames(input, { system: "Test." }), []);
  });
  it("retains snapshots before project mutation", () => {
    const input = {}, config = snapshot(), discovery = snapshot();
    bindSourceObservationStages(input, { identity, config, discovery });
    discovery.members[0]!.sha256 = "c".repeat(64);
    assertEquals(
      JSON.parse(prepareSourceObservationFrames(input, { system: "Test." })[1]!).snapshot.members[0]
        .sha256,
      "b".repeat(64),
    );
  });
  it("rejects an oversized serialized frame", () => {
    const input = {}, large = snapshot();
    large.members = Array.from(
      { length: 256 },
      (_, i) => ({ path: `${i}-${"x".repeat(500)}.ts`, sha256: "b".repeat(64) }),
    );
    bindSourceObservationStages(input, { identity, config: large, discovery: large });
    assertEquals(prepareSourceObservationFrames(input, { system: "Test." }), []);
  });
});

Deno.test("project imports cannot replace an ingress-bound input observation", () => {
  const input = {}, original = { ...identity };
  bindSourceObservationStages(input, {
    identity: original,
    config: snapshot(),
    discovery: snapshot(),
  });
  bindSourceObservationStages(input, {
    identity: { ...identity, agentId: "forged" },
    config: snapshot(),
    discovery: snapshot(),
  });
  assertEquals(
    JSON.parse(prepareSourceObservationFrames(input, { system: "Test." })[0]!).identity.agentId,
    identity.agentId,
  );
});
