import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type DefaultResearchArtifactContext,
  extractLatestUserText,
  mirrorDefaultResearchRunArtifact,
  shouldRetryCreateResearchArtifactAsUpdate,
  updateDefaultResearchArtifacts,
} from "./default-research-artifact-support.ts";

function defaultArtifacts() {
  return {
    topicSlug: "ai-coding-agents",
    topicRootPath: "/research/ai-coding-agents",
    currentReportPath: "/research/ai-coding-agents/report.md",
    runReportPath: "/research/ai-coding-agents/runs/run-1.report.md",
    findingsPath: "/research/ai-coding-agents/findings.md",
    sourcesPath: "/research/ai-coding-agents/sources.md",
  };
}

describe("default research artifact support", () => {
  it("extracts the latest user text from string and part-array messages", () => {
    assertEquals(
      extractLatestUserText([
        { role: "user", content: "old" },
        { role: "assistant", content: "ignore" },
        { role: "user", content: [{ type: "text", text: "latest" }] },
      ]),
      "latest",
    );
  });

  it("updates task context and appends a system reminder", () => {
    const taskContext: DefaultResearchArtifactContext = { parentRunId: "run-1" };
    const system = updateDefaultResearchArtifacts({
      taskContext,
      latestUserText: "/research Research AI coding agents and save the report to the project.",
      system: "base",
    });

    assertEquals(typeof system, "string");
    assertEquals(
      taskContext.defaultResearchArtifacts?.currentReportPath,
      "/research/ai-coding-agents/report.md",
    );
  });

  it("retries existing-file collisions for explicit research markdown paths without injected defaults", () => {
    assertEquals(
      shouldRetryCreateResearchArtifactAsUpdate({
        toolName: "create_file",
        toolInput: {
          path: "research/ai-coding-agents/sources.md",
          content: "# sources",
        },
        taskContext: {},
        error: {
          output: {
            error: "tool_error",
            message: "File already exists: research/ai-coding-agents/sources.md",
          },
        },
      }),
      true,
    );
  });

  it("retries MCP isError content collisions for explicit research markdown paths", () => {
    assertEquals(
      shouldRetryCreateResearchArtifactAsUpdate({
        toolName: "create_file",
        toolInput: {
          path: "research/ai-coding-agents/sources.md",
          content: "# sources",
        },
        taskContext: {},
        error: {
          isError: true,
          content: [{
            type: "text",
            text: "File already exists: research/ai-coding-agents/sources.md",
          }],
        },
      }),
      true,
    );
  });

  it("does not retry non-research create_file collisions without injected defaults", () => {
    assertEquals(
      shouldRetryCreateResearchArtifactAsUpdate({
        toolName: "create_file",
        toolInput: {
          path: "src/app.ts",
          content: "export {}",
        },
        taskContext: {},
        error: { message: "File already exists: src/app.ts" },
      }),
      false,
    );
  });

  it("falls back to update_file when create_file throws a nested existing-file tool result", async () => {
    const calls: Array<
      {
        toolName: string;
        args: Record<string, unknown>;
        context: Record<string, unknown> | undefined;
      }
    > = [];

    await mirrorDefaultResearchRunArtifact({
      toolName: "create_file",
      toolInput: {
        path: "research/ai-coding-agents/report.md",
        content: "# report",
      },
      taskContext: {
        defaultResearchArtifacts: defaultArtifacts(),
      },
      activeProjectId: "project-1",
      executeContext: { projectId: "project-1" },
      executeTool: (toolName, args, context) => {
        calls.push({ toolName, args, context });
        if (calls.length === 1) {
          throw {
            output: {
              error: "tool_error",
              message: "File already exists: research/ai-coding-agents/runs/run-1.report.md",
            },
          };
        }
        return Promise.resolve({ path: "research/ai-coding-agents/runs/run-1.report.md" });
      },
    });

    assertEquals(calls, [
      {
        toolName: "create_file",
        args: {
          path: "research/ai-coding-agents/runs/run-1.report.md",
          content: "# report",
          project_reference: "project-1",
        },
        context: { projectId: "project-1" },
      },
      {
        toolName: "update_file",
        args: {
          path: "research/ai-coding-agents/runs/run-1.report.md",
          content: "# report",
          project_reference: "project-1",
        },
        context: { projectId: "project-1" },
      },
    ]);
  });
});
