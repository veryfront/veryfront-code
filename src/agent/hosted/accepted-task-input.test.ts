import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ACCEPTED_TASK_INPUT_EVENT_TYPE,
  type HostedAcceptedTaskInputEvent,
  snapshotHostedAcceptedTaskInputEvent,
} from "./accepted-task-input.ts";

const receipt = (): HostedAcceptedTaskInputEvent => ({
  type: ACCEPTED_TASK_INPUT_EVENT_TYPE,
  version: 1,
  targetAgentId: "child-agent",
  sourceEventIds: [1, 2],
  artifactVersions: [{
    path: "intake.json",
    version_id: "11111111-1111-4111-8111-111111111111",
    sha256: "a".repeat(64),
    size_bytes: 12,
  }],
  payload: { intakeId: "intake-1" },
});
const snapshot = (value: unknown) =>
  snapshotHostedAcceptedTaskInputEvent(value as HostedAcceptedTaskInputEvent);

describe("accepted task input receipt validation", () => {
  it("snapshots reordered receipt and artifact keys without retaining caller mutations", () => {
    const original = receipt();
    const reordered: Record<string, unknown> = Object.fromEntries(
      Object.entries(original).reverse(),
    );
    reordered.artifactVersions = original.artifactVersions.map((ref) =>
      Object.fromEntries(Object.entries(ref).reverse())
    );
    const accepted = snapshot(reordered);
    assertEquals(accepted, original);
    assertEquals(Object.isFrozen(accepted), true);
    assertEquals(Object.isFrozen(accepted.artifactVersions[0]), true);
    reordered.payload = { intakeId: "mutated" };
    assertEquals(accepted.payload, { intakeId: "intake-1" });
  });

  it("rejects malformed receipt identity, event provenance and transport budgets", () => {
    for (
      const patch of [
        { extra: true },
        { type: "other" },
        { version: 2 },
        { targetAgentId: "" },
        { targetAgentId: 1 },
        { targetAgentId: "a".repeat(256) },
        { sourceEventIds: "not-an-array" },
        { sourceEventIds: [] },
        { sourceEventIds: Array.from({ length: 9 }, (_, i) => i + 1) },
        { sourceEventIds: [0] },
        { sourceEventIds: [-1] },
        { sourceEventIds: [1.5] },
        { sourceEventIds: [Number.MAX_SAFE_INTEGER + 1] },
        { sourceEventIds: [1, 1] },
        { artifactVersions: "not-an-array" },
        { artifactVersions: [] },
        { artifactVersions: Array(9).fill(receipt().artifactVersions[0]) },
      ]
    ) assertThrows(() => snapshot({ ...receipt(), ...patch }));
  });

  it("rejects malformed artifact identity and impossible byte counts", () => {
    for (
      const patch of [
        { extra: true },
        { path: "" },
        { path: 1 },
        { path: "a".repeat(513) },
        { version_id: "current" },
        { sha256: "a".repeat(63) },
        { sha256: "A".repeat(64) },
        { size_bytes: -1 },
        { size_bytes: 1.5 },
        { size_bytes: 1_000_000_001 },
      ]
    ) {
      assertThrows(() =>
        snapshot({
          ...receipt(),
          artifactVersions: [{ ...receipt().artifactVersions[0], ...patch }],
        })
      );
    }
    for (const size_bytes of [0, 1_000_000_000]) {
      assertEquals(
        snapshot({
          ...receipt(),
          artifactVersions: [{ ...receipt().artifactVersions[0], size_bytes }],
        }).artifactVersions[0]!.size_bytes,
        size_bytes,
      );
    }
  });

  it("rejects accessor-backed receipt fields before executing application code", () => {
    let reads = 0;
    const value = Object.defineProperty(receipt(), "payload", {
      enumerable: true,
      get() {
        reads++;
        return {};
      },
    });
    assertThrows(() => snapshot(value));
    assertEquals(reads, 0);
  });
});
