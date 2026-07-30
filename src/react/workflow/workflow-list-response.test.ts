import { assertEquals, assertThrows } from "@std/assert";
import type { WorkflowRun } from "#veryfront/workflow/types.ts";
import { parseWorkflowListResponse } from "./workflow-list-response.ts";

Deno.test("parseWorkflowListResponse accepts and snapshots the documented envelope", () => {
  const firstRun = { id: "run-1" } as unknown as WorkflowRun;
  const runs = [firstRun];
  const parsed = parseWorkflowListResponse({ runs, cursor: "next", totalCount: 1 });

  runs.push({ id: "run-2" } as unknown as WorkflowRun);

  assertEquals(parsed, {
    runs: [firstRun],
    cursor: "next",
    totalCount: 1,
  });
});

Deno.test("parseWorkflowListResponse rejects legacy bare-array responses", () => {
  assertThrows(
    () => parseWorkflowListResponse([]),
    Error,
    "expected an object with a runs array",
  );
});

Deno.test("parseWorkflowListResponse rejects malformed envelope fields", () => {
  for (
    const value of [
      null,
      {},
      { runs: null },
      { runs: [], cursor: 1 },
      { runs: [], totalCount: -1 },
      { runs: [], totalCount: 1.5 },
    ]
  ) {
    assertThrows(
      () => parseWorkflowListResponse(value),
      Error,
      "Invalid workflow run list response",
    );
  }
});

Deno.test("parseWorkflowListResponse rejects accessors without invoking them", () => {
  let getterCalls = 0;
  const response = Object.defineProperty({}, "runs", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return [];
    },
  });

  assertThrows(() => parseWorkflowListResponse(response), Error, "runs must be a data property");
  assertEquals(getterCalls, 0);
});
