import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveHostedTaskInput } from "./task-input.ts";
const scope = { projectId: "project-a", rootRunId: "root-a", runId: "child-a" };
const binding = () => ({
  version: 1 as const,
  ...scope,
  payload: { intakeId: "intake-a", nested: { path: "artifact" } },
});
describe("host-owned task input", () => {
  it("clones and freezes a valid binding across host reconstruction", () => {
    const original = binding();
    const first = resolveHostedTaskInput(original, scope)!;
    original.payload.nested.path = "mutated";
    assertEquals(first.payload, { intakeId: "intake-a", nested: { path: "artifact" } });
    assertEquals(Object.isFrozen(first), true);
    assertEquals(Object.isFrozen(first.payload), true);
    assertEquals(Object.isFrozen(first.payload.nested), true);
    assertEquals(resolveHostedTaskInput(JSON.parse(JSON.stringify(first)), scope), first);
  });
  it("keeps absent input absent", () => {
    assertEquals(resolveHostedTaskInput(undefined, scope), undefined);
  });
  it("rejects wrong or absent host authority", () => {
    for (const key of ["projectId", "rootRunId", "runId"] as const) {
      assertThrows(() => resolveHostedTaskInput({ ...binding(), [key]: "other" }, scope));
      assertThrows(() => resolveHostedTaskInput(binding(), { ...scope, [key]: undefined }));
    }
  });
  it("rejects malformed, non-JSON, oversized and extra envelope fields", () => {
    for (
      const candidate of [
        null,
        {},
        { ...binding(), version: 2 },
        { ...binding(), authToken: "injected" },
        { ...binding(), payload: { value: undefined } },
        { ...binding(), payload: { value: Infinity } },
        { ...binding(), payload: { value: () => 1 } },
        { ...binding(), payload: new Date() },
        { ...binding(), payload: { value: new Array(2) } },
        { ...binding(), payload: Object.defineProperty({}, "hidden", { value: 1 }) },
        { ...binding(), payload: { value: "x".repeat(16_385) } },
      ]
    ) assertThrows(() => resolveHostedTaskInput(candidate, scope));
  });
});
