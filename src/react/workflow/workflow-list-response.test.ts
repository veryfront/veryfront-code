import { assertEquals, assertThrows } from "@std/assert";
import { createDemoWorkflowRun } from "../../../cli/templates/files/agentic-workflow/app/api/workflows/sample-runs.ts";
import { parseWorkflowListResponse } from "./workflow-list-response.ts";
import { workflowRunWire } from "./workflow-hook-test-utils.test.ts";
import { parseWorkflowRunResponse } from "./workflow-wire.ts";

Deno.test("parseWorkflowListResponse accepts and snapshots the documented envelope", () => {
  const firstRun = workflowRunWire("run-1");
  const runs = [firstRun];
  const parsed = parseWorkflowListResponse({ runs, cursor: "next", totalCount: 1 });

  runs.push(workflowRunWire("run-2"));
  firstRun.id = "mutated";

  assertEquals(parsed.runs.length, 1);
  assertEquals(parsed.runs[0]?.id, "run-1");
  assertEquals(parsed.runs[0]?.createdAt instanceof Date, true);
  assertEquals(parsed.cursor, "next");
  assertEquals(parsed.totalCount, 1);
});

Deno.test("parseWorkflowListResponse rejects malformed run entries", () => {
  assertThrows(
    () => parseWorkflowListResponse({ runs: [{ id: "run-1", status: "running" }] }),
    Error,
    "Invalid workflow run response",
  );
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
      { runs: [], cursor: "x".repeat(256 * 1024 + 1) },
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

Deno.test("parseWorkflowListResponse enforces one aggregate snapshot budget", () => {
  const runs = Array.from({ length: 5 }, (_, index) => {
    const run = workflowRunWire(`run-${index}`);
    run.input = "x".repeat(220_000);
    return run;
  });

  assertThrows(
    () => parseWorkflowListResponse({ runs }),
    Error,
    "payload strings exceed protocol limits",
  );
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

Deno.test("the shipped agentic-workflow fixture satisfies the canonical hook contract", () => {
  const wire = createDemoWorkflowRun(
    "template-run",
    "Template contract",
    "content-pipeline",
  );
  const detail = parseWorkflowRunResponse(wire);
  const list = parseWorkflowListResponse({ runs: [wire], totalCount: 1 });

  assertEquals(detail.id, "template-run");
  assertEquals(detail.status, "completed");
  assertEquals(detail.currentNodes, []);
  assertEquals(detail.nodeStates.research?.nodeId, "research");
  assertEquals(detail.nodeStates.research?.attempt, 1);
  assertEquals(detail.context.input, { topic: "Template contract" });
  assertEquals(detail.createdAt instanceof Date, true);
  assertEquals(Object.hasOwn(detail, "steps"), false);
  assertEquals(list.runs[0], detail);
});

Deno.test("parseWorkflowRunResponse fails closed on durable execution metadata", () => {
  const tenantRun = workflowRunWire("tenant-run");
  tenantRun._tenant = {
    projectSlug: "secret-project",
    token: "secret-token",
    productionMode: true,
  };
  assertThrows(
    () => parseWorkflowRunResponse(tenantRun),
    Error,
    "internal execution metadata",
  );

  const runtimeRun = workflowRunWire("runtime-run");
  runtimeRun._runtimeStateVersion = 1;
  assertThrows(
    () => parseWorkflowRunResponse(runtimeRun),
    Error,
    "internal execution metadata",
  );

  const contextRun = workflowRunWire("context-run");
  (contextRun.context as Record<string, unknown>).env = { SECRET: "value" };
  assertThrows(
    () => parseWorkflowRunResponse(contextRun),
    Error,
    "internal execution metadata",
  );
});

Deno.test("parseWorkflowRunResponse enforces canonical source integration policies", () => {
  for (
    const sourceIntegrationPolicy of [
      { schemaVersion: 1, mode: "unrestricted", extra: true },
      {
        schemaVersion: 1,
        mode: "allowlist",
        integrations: { GitHub: { allowedToolIds: null } },
      },
      {
        schemaVersion: 1,
        mode: "allowlist",
        integrations: { github: { allowedToolIds: ["issues", "issues"] } },
      },
      {
        schemaVersion: 1,
        mode: "allowlist",
        integrations: { github: { allowedToolIds: null, extra: true } },
      },
    ]
  ) {
    const run = workflowRunWire("policy-run");
    run.sourceIntegrationPolicy = sourceIntegrationPolicy;
    assertThrows(
      () => parseWorkflowRunResponse(run),
      Error,
      "sourceIntegrationPolicy is invalid",
    );
  }

  const excessive = workflowRunWire("excessive-policy-run");
  excessive.sourceIntegrationPolicy = {
    schemaVersion: 1,
    mode: "allowlist",
    integrations: {
      github: {
        allowedToolIds: Array.from({ length: 600 }, (_, index) => `tool-${index}`),
      },
      slack: {
        allowedToolIds: Array.from({ length: 600 }, (_, index) => `tool-${index}`),
      },
    },
  };
  assertThrows(
    () => parseWorkflowRunResponse(excessive),
    Error,
    "sourceIntegrationPolicy is invalid",
  );
});
