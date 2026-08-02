import { assertEquals, assertThrows } from "@std/assert";
import { admitPromptRender, admitResourceRead, admitToolExecution } from "./MCPTab.tsx";
import { admitWorkflowExecution } from "./WorkflowsTab.tsx";

Deno.test("dashboard mutation admission accepts explicit success responses", () => {
  assertEquals(admitToolExecution({ success: true, result: { ok: true }, duration: 2 }), {
    result: { ok: true },
    duration: 2,
  });
  assertEquals(admitResourceRead({ success: true, data: ["content"], duration: 3 }), {
    data: ["content"],
    duration: 3,
  });
  assertEquals(admitPromptRender({ success: true, content: "Hello" }), { content: "Hello" });
  assertEquals(
    admitWorkflowExecution({
      success: true,
      result: { done: true },
      duration: 4,
      runId: "run-1",
      status: "completed",
    }),
    {
      result: { done: true },
      duration: 4,
      runId: "run-1",
      status: "completed",
    },
  );
});

Deno.test("dashboard mutation admission rejects false success and missing payloads", () => {
  assertThrows(
    () => admitToolExecution({ success: false, result: null }),
    TypeError,
    "must be true",
  );
  assertThrows(
    () => admitResourceRead({ success: true }),
    TypeError,
    "data is required",
  );
  assertThrows(
    () => admitPromptRender({ success: true, content: 42 }),
    TypeError,
    "must be a string",
  );
  assertThrows(
    () => admitWorkflowExecution({ success: true }),
    TypeError,
    "result is required",
  );
});
