import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  buildHostedChildToolDescription,
  expandHostedChildRequestedTools,
  sanitizeHostedChildRequestedTools,
  shouldPruneSandboxToolsFromHostedChildRequest,
} from "./hosted-child-requested-tools.ts";

const sandboxCuePattern = /\b(bash|shell|terminal|python|node|npm)\b/i;
const textArtifactPrompt = (prompt: string) => /\b(markdown|report)\b/i.test(prompt);

Deno.test("expandHostedChildRequestedTools returns undefined when tools are omitted", () => {
  assertEquals(expandHostedChildRequestedTools({}), undefined);
});

Deno.test("expandHostedChildRequestedTools preserves empty requested tool arrays", () => {
  assertEquals(expandHostedChildRequestedTools({ requestedTools: [] }), []);
});

Deno.test("expandHostedChildRequestedTools removes excluded tools and adds companions", () => {
  const result = expandHostedChildRequestedTools({
    requestedTools: ["shell", "panel", "create_file"],
    excludedTools: new Set(["panel"]),
    companionTools: { create_file: ["update_file"] },
  });

  assertEquals(result, ["shell", "create_file", "update_file"]);
});

Deno.test("expandHostedChildRequestedTools removes excluded companion tools", () => {
  const result = expandHostedChildRequestedTools({
    requestedTools: ["create_file"],
    excludedTools: new Set(["update_file"]),
    companionTools: { create_file: ["update_file"] },
  });

  assertEquals(result, ["create_file"]);
});

Deno.test("sanitizeHostedChildRequestedTools prunes sandbox tools for text artifact prompts without sandbox cues", () => {
  const result = sanitizeHostedChildRequestedTools({
    prompt: "Write a markdown report",
    requestedTools: ["create_file", "bash", "readFile"],
    sandboxRequiredCuePattern: sandboxCuePattern,
    isTextArtifactPrompt: textArtifactPrompt,
  });

  assertEquals(result, ["create_file"]);
});

Deno.test("sanitizeHostedChildRequestedTools keeps sandbox tools when prompt contains sandbox cues", () => {
  const result = sanitizeHostedChildRequestedTools({
    prompt: "Write a markdown report using python",
    requestedTools: ["create_file", "bash"],
    sandboxRequiredCuePattern: sandboxCuePattern,
    isTextArtifactPrompt: textArtifactPrompt,
  });

  assertEquals(result, ["create_file", "bash"]);
});

Deno.test("shouldPruneSandboxToolsFromHostedChildRequest is deterministic for stateful regex cues", () => {
  const statefulSandboxCuePattern = /\bpython\b/gi;
  const input = {
    prompt: "Write a markdown report using python",
    requestedTools: ["create_file", "bash"],
    sandboxRequiredCuePattern: statefulSandboxCuePattern,
    isTextArtifactPrompt: textArtifactPrompt,
  };

  assertEquals(shouldPruneSandboxToolsFromHostedChildRequest(input), false);
  assertEquals(shouldPruneSandboxToolsFromHostedChildRequest(input), false);
});

Deno.test("shouldPruneSandboxToolsFromHostedChildRequest requires artifact tools", () => {
  assertEquals(
    shouldPruneSandboxToolsFromHostedChildRequest({
      prompt: "Write a markdown report",
      requestedTools: ["bash"],
      sandboxRequiredCuePattern: sandboxCuePattern,
      isTextArtifactPrompt: textArtifactPrompt,
    }),
    false,
  );
});

Deno.test("buildHostedChildToolDescription describes child agent usage", () => {
  const description = buildHostedChildToolDescription();
  assertEquals(description.includes("child agent"), true);
  assertEquals(description.includes("parallel"), true);
});
