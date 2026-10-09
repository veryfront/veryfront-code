import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { parseAgUiSseResponse } from "#veryfront/agent/ag-ui/sse-parser.ts";
import { containsSkillLoad } from "./runner.ts";

Deno.test("live evals recognize both platform skill-loader spellings", async () => {
  for (const toolName of ["load_skill", "veryfront__load_skill", "project_load_skill"]) {
    const events = [
      { type: "TOOL_CALL_START", toolCallId: "skill-call", toolCallName: toolName },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "skill-call",
        delta: JSON.stringify({ skillId: "invoice" }),
      },
      { type: "TOOL_CALL_END", toolCallId: "skill-call" },
      { type: "RUN_FINISHED", runId: "eval-run" },
    ];
    const response = new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      {
        headers: { "Content-Type": "text/event-stream" },
      },
    );
    const run = await parseAgUiSseResponse(response);
    assertEquals(containsSkillLoad(run, "invoice"), toolName !== "project_load_skill");
    assertEquals(containsSkillLoad(run, "missing-skill"), false);
  }
});

Deno.test("live eval skill load matches only the arguments of its own loader call", async () => {
  const events = [
    { type: "TOOL_CALL_START", toolCallId: "load", toolCallName: "veryfront__load_skill" },
    { type: "TOOL_CALL_ARGS", toolCallId: "load", delta: JSON.stringify({ skillId: "other" }) },
    { type: "TOOL_CALL_START", toolCallId: "unrelated", toolCallName: "get_file" },
    {
      type: "TOOL_CALL_ARGS",
      toolCallId: "unrelated",
      delta: JSON.stringify({ path: "invoice.md" }),
    },
  ];
  const run = await parseAgUiSseResponse(
    new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
  );
  assertEquals(containsSkillLoad(run, "invoice"), false);
  assertEquals(containsSkillLoad(run, "other"), true);
});

Deno.test("live eval skill load requires complete exact skill arguments", async () => {
  for (const delta of ['{"skillId":', "not-json", '{"skillId":"invoice-extra"}']) {
    const events = [
      { type: "TOOL_CALL_START", toolCallId: "load", toolCallName: "load_skill" },
      { type: "TOOL_CALL_ARGS", toolCallId: "load", delta },
    ];
    const run = await parseAgUiSseResponse(
      new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
    );
    assertEquals(containsSkillLoad(run, "invoice"), false);
  }
});
