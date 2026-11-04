import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  bindSourceObservationStages,
  prepareSourceObservationFrames,
} from "#veryfront/internal-agents/source-observation.ts";
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
Deno.test("project array hooks never receive captured source evidence", () => {
  const input = {};
  bindSourceObservationStages(input, { identity, config: snapshot(), discovery: snapshot() });
  const map = Array.prototype.map;
  const every = Array.prototype.every;
  let leaked = false;
  let frames: readonly string[] = [];
  try {
    Array.prototype.map = function (...args) {
      for (let i = 0; i < this.length; i++) {
        const value = this[i];
        if (value?.snapshot?.members) {
          leaked = true;
          value.snapshot.members[0].sha256 = "c".repeat(64);
        }
      }
      return Reflect.apply(map, this, args);
    };
    Object.defineProperty(Array.prototype, "every", {
      configurable: true,
      writable: true,
      value: function (this: unknown[], ...args: Parameters<typeof every>): boolean {
        return Reflect.apply(every, this, args);
      },
    });
    frames = prepareSourceObservationFrames(input, { system: "Test.", toolLoading: "eager" });
  } finally {
    Array.prototype.map = map;
    Array.prototype.every = every;
  }
  assertEquals(leaked, false);
  assertEquals(JSON.parse(frames[0]!).snapshot.members[0].sha256, "b".repeat(64));
});

Deno.test("inherited descriptor fields cannot break private frame construction", () => {
  const input = {};
  bindSourceObservationStages(input, { identity, config: snapshot(), discovery: snapshot() });
  const define = Object.defineProperty;
  let frames: readonly string[] = [];
  try {
    const descriptor = { __proto__: null, value: undefined, configurable: true };
    define(Object.prototype, "get", descriptor);
    frames = prepareSourceObservationFrames(input, { system: "Test.", toolLoading: "eager" });
  } finally {
    delete (Object.prototype as { get?: unknown }).get;
  }
  assertEquals(frames.length, 2);
});
