import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  getHostedChildWrittenArtifactPath,
  isHostedChildCreateFileAlreadyExistsResult,
  isHostedChildTextProjectArtifactPrompt,
  normalizeHostedChildArtifactPath,
} from "./hosted-child-artifact-support.ts";

Deno.test("isHostedChildTextProjectArtifactPrompt recognizes markdown artifact cues", () => {
  assertEquals(isHostedChildTextProjectArtifactPrompt("Create a markdown research report"), true);
  assertEquals(isHostedChildTextProjectArtifactPrompt("Write to docs/output.md"), true);
  assertEquals(isHostedChildTextProjectArtifactPrompt("Build a React component"), false);
});

Deno.test("isHostedChildCreateFileAlreadyExistsResult recognizes direct and nested tool errors", () => {
  assertEquals(
    isHostedChildCreateFileAlreadyExistsResult({
      isError: true,
      content: [{ type: "text", text: "The file already exists at /docs/report.md" }],
    }),
    true,
  );

  assertEquals(
    isHostedChildCreateFileAlreadyExistsResult({
      error: "tool_error",
      message: "File already exists: research/ai-coding-agents/sources.md",
    }),
    true,
  );

  assertEquals(
    isHostedChildCreateFileAlreadyExistsResult({
      output: {
        error: "tool_error",
        message: "File already exists: research/ai-coding-agents/sources.md",
      },
    }),
    true,
  );
});

Deno.test("isHostedChildCreateFileAlreadyExistsResult rejects successful or unknown results", () => {
  assertEquals(
    isHostedChildCreateFileAlreadyExistsResult({
      content: [{ type: "text", text: "File created" }],
    }),
    false,
  );
  assertEquals(isHostedChildCreateFileAlreadyExistsResult(null), false);
  assertEquals(isHostedChildCreateFileAlreadyExistsResult("string"), false);
  assertEquals(isHostedChildCreateFileAlreadyExistsResult(42), false);
});

Deno.test("normalizeHostedChildArtifactPath normalizes project artifact paths", () => {
  assertEquals(normalizeHostedChildArtifactPath("docs/report.md"), "/docs/report.md");
  assertEquals(normalizeHostedChildArtifactPath("./plans/report.md"), "/plans/report.md");
  assertEquals(normalizeHostedChildArtifactPath("'/plans/report.md,'"), "/plans/report.md");
  assertEquals(normalizeHostedChildArtifactPath("https://example.com/report.md"), null);
  assertEquals(normalizeHostedChildArtifactPath("/workspace/report.md"), null);
});

Deno.test("getHostedChildWrittenArtifactPath returns normalized paths for writing tools", () => {
  assertEquals(
    getHostedChildWrittenArtifactPath({
      toolName: "create_file",
      toolInput: { path: "docs/report.md", content: "hello" },
      toolOutput: { content: [{ text: "created" }] },
    }),
    "/docs/report.md",
  );

  assertEquals(
    getHostedChildWrittenArtifactPath({
      toolName: "update_file",
      toolInput: { path: "/plans/research.md", content: "updated" },
      toolOutput: {},
    }),
    "/plans/research.md",
  );
});

Deno.test("getHostedChildWrittenArtifactPath ignores non-writing tools, failed writes, and missing paths", () => {
  assertEquals(
    getHostedChildWrittenArtifactPath({
      toolName: "bash",
      toolInput: { path: "docs/report.md" },
      toolOutput: {},
    }),
    null,
  );
  assertEquals(
    getHostedChildWrittenArtifactPath({
      toolName: "create_file",
      toolInput: { path: "test.md" },
      toolOutput: { isError: true, content: [{ text: "failed" }] },
    }),
    null,
  );
  assertEquals(
    getHostedChildWrittenArtifactPath({
      toolName: "create_file",
      toolInput: { content: "no path" },
      toolOutput: {},
    }),
    null,
  );
});
