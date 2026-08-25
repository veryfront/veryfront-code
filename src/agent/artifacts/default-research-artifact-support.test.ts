import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import {
  applyDefaultResearchArtifactPath,
  createDefaultResearchRunArtifactMirrorHandler,
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

    assertStringIncludes(
      system as string,
      "base",
      "the caller's existing system text is preserved",
    );
    assertStringIncludes(
      system as string,
      "Default research workspace (because no exact artifact path was provided):",
      "the research workspace reminder is appended to the system prompt",
    );
    assertStringIncludes(
      system as string,
      "/research/ai-coding-agents/runs/run-1.report.md",
      "the reminder names the run-scoped report path",
    );
    assertStringIncludes(
      system as string,
      "/research/ai-coding-agents/report.md",
      "the reminder names the current topic report path",
    );
    assertEquals(
      taskContext.defaultResearchArtifacts?.currentReportPath,
      "/research/ai-coding-agents/report.md",
    );
  });

  it("does not append the research workspace reminder twice", () => {
    const taskContext: DefaultResearchArtifactContext = { parentRunId: "run-1" };
    const latestUserText =
      "/research Research AI coding agents and save the report to the project.";
    const first = updateDefaultResearchArtifacts({ taskContext, latestUserText, system: "base" });
    const second = updateDefaultResearchArtifacts({ taskContext, latestUserText, system: first });

    assertEquals(second, first, "the reminder is not appended twice");
  });

  it("appends the research workspace reminder as its own system message", () => {
    const taskContext: DefaultResearchArtifactContext = { parentRunId: "run-1" };
    const result = updateDefaultResearchArtifacts({
      taskContext,
      latestUserText: "/research Research AI coding agents and save the report to the project.",
      system: [{ role: "system", content: "base" }],
    }) as ChatSystemMessage[];

    assertEquals(result.length, 2, "the array form keeps the caller's system message");
    assertEquals(
      result[0],
      { role: "system", content: "base" },
      "the caller's system message is left untouched",
    );
    const reminder = result[1];
    assert(reminder, "the array form appends a second system message");
    assertEquals(reminder.role, "system", "the reminder is pushed with the system role");
    assertStringIncludes(
      reminder.content,
      "Default research workspace",
      "the array form pushes the reminder as its own system message",
    );
  });

  it("canonicalizes default research topic-root markdown files to the current report path", () => {
    assertEquals(
      applyDefaultResearchArtifactPath(
        "create_file",
        {
          path: "research/ai-coding-agents.md",
          content: "# report",
        },
        {
          defaultResearchArtifacts: defaultArtifacts(),
        },
      ),
      {
        path: "research/ai-coding-agents/report.md",
        content: "# report",
      },
    );
  });

  it("canonicalizes any other report.md path onto the injected current report path", () => {
    assertEquals(
      applyDefaultResearchArtifactPath(
        "update_file",
        {
          path: "research/ai-coding-agents-v2/report.md",
          content: "# r",
        },
        {
          defaultResearchArtifacts: defaultArtifacts(),
        },
      ),
      {
        path: "research/ai-coding-agents/report.md",
        content: "# r",
      },
      "an invented topic folder must be redirected to the canonical report",
    );
  });

  it("leaves canonical supporting artifacts and non-report paths untouched", () => {
    const taskContext = { defaultResearchArtifacts: defaultArtifacts() };
    const untouchedPaths = [
      "research/ai-coding-agents/findings.md",
      "research/ai-coding-agents/sources.md",
      "research/ai-coding-agents/runs/run-1.report.md",
      "docs/notes.md",
    ];

    for (const path of untouchedPaths) {
      const toolInput = { path, content: "# r" };
      assertEquals(
        applyDefaultResearchArtifactPath("update_file", toolInput, taskContext),
        toolInput,
        "canonical supporting artifacts must be returned untouched",
      );
    }
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

  it("scopes create-file retries to the injected research topic root", () => {
    assertEquals(
      shouldRetryCreateResearchArtifactAsUpdate({
        toolName: "create_file",
        toolInput: {
          path: "research/ai-coding-agents/findings.md",
          content: "# findings",
        },
        taskContext: { defaultResearchArtifacts: defaultArtifacts() },
        error: {
          output: {
            error: "tool_error",
            message: "File already exists: research/ai-coding-agents/findings.md",
          },
        },
      }),
      true,
      "a collision inside the run topic root must retry as update_file",
    );

    assertEquals(
      shouldRetryCreateResearchArtifactAsUpdate({
        toolName: "create_file",
        toolInput: {
          path: "research/other-topic/report.md",
          content: "# report",
        },
        taskContext: { defaultResearchArtifacts: defaultArtifacts() },
        error: {
          output: {
            error: "tool_error",
            message: "File already exists: research/other-topic/report.md",
          },
        },
      }),
      false,
      "a collision outside the run topic root must not overwrite another topic report",
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

  it("mirrors when the tool result reports the canonical current report path", async () => {
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
        path: "research/ai-coding-agents-draft/report.md",
        content: "# report",
      },
      toolResult: {
        path: "research/ai-coding-agents/report.md",
      },
      taskContext: {
        defaultResearchArtifacts: defaultArtifacts(),
      },
      activeProjectId: "project-1",
      executeContext: { projectId: "project-1" },
      executeTool: (toolName, args, context) => {
        calls.push({ toolName, args, context });
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
    ]);
  });

  it("derives the run-scoped mirror path from an effective research report result", async () => {
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
        path: "research/durable-run-staging-canary/report.md",
        content: "# report",
      },
      toolResult: {
        path: "research/durable-run-staging-canary-behavior/report.md",
      },
      taskContext: {
        parentRunId: "run_192c702c-9070-4aad-acac-db7f3158af3e",
      },
      activeProjectId: "project-1",
      executeContext: { projectId: "project-1" },
      executeTool: (toolName, args, context) => {
        calls.push({ toolName, args, context });
        return Promise.resolve({
          path:
            "research/durable-run-staging-canary-behavior/runs/run_192c702c-9070-4aad-acac-db7f3158af3e.report.md",
        });
      },
    });

    assertEquals(calls, [
      {
        toolName: "create_file",
        args: {
          path:
            "research/durable-run-staging-canary-behavior/runs/run_192c702c-9070-4aad-acac-db7f3158af3e.report.md",
          content: "# report",
          project_reference: "project-1",
        },
        context: { projectId: "project-1" },
      },
    ]);
  });

  it("prefers the returned canonical report path over stale injected defaults", async () => {
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
        path: "research/durable-run-staging-canary/report.md",
        content: "# report",
      },
      toolResult: {
        path: "research/durable-run-staging-canary-behavior/report.md",
      },
      taskContext: {
        parentRunId: "run_4fee8a83-cb68-4075-bef8-ca16eca50770",
        defaultResearchArtifacts: defaultArtifacts(),
      },
      activeProjectId: "project-1",
      executeContext: { projectId: "project-1" },
      executeTool: (toolName, args, context) => {
        calls.push({ toolName, args, context });
        return Promise.resolve({
          path:
            "research/durable-run-staging-canary-behavior/runs/run_4fee8a83-cb68-4075-bef8-ca16eca50770.report.md",
        });
      },
    });

    assertEquals(calls, [
      {
        toolName: "create_file",
        args: {
          path:
            "research/durable-run-staging-canary-behavior/runs/run_4fee8a83-cb68-4075-bef8-ca16eca50770.report.md",
          content: "# report",
          project_reference: "project-1",
        },
        context: { projectId: "project-1" },
      },
    ]);
  });

  it("creates a mirror handler from the API remote tool source", async () => {
    const calls: Array<
      {
        toolName: string;
        args: Record<string, unknown>;
        context: Record<string, unknown> | undefined;
      }
    > = [];
    const handler = createDefaultResearchRunArtifactMirrorHandler({
      taskContext: {
        projectId: "fallback-project",
        defaultResearchArtifacts: defaultArtifacts(),
      },
      remoteToolSource: {
        executeTool: (toolName, args, context) => {
          calls.push({ toolName, args, context });
          return Promise.resolve({
            path: "research/ai-coding-agents/runs/run-1.report.md",
          });
        },
      },
    });

    await handler({
      toolName: "create_file",
      input: {
        path: "research/ai-coding-agents/report.md",
        content: "# report",
      },
      result: {
        path: "research/ai-coding-agents/report.md",
      },
      context: {},
    });

    assertEquals(calls, [
      {
        toolName: "create_file",
        args: {
          path: "research/ai-coding-agents/runs/run-1.report.md",
          content: "# report",
          project_reference: "fallback-project",
        },
        context: {},
      },
    ]);
  });

  it("skips mirror handler writes for errored tool results", async () => {
    const calls: string[] = [];
    const handler = createDefaultResearchRunArtifactMirrorHandler({
      taskContext: {
        defaultResearchArtifacts: defaultArtifacts(),
      },
      remoteToolSource: {
        executeTool: (toolName) => {
          calls.push(toolName);
          return Promise.resolve(undefined);
        },
      },
    });

    await handler({
      toolName: "create_file",
      input: {
        path: "research/ai-coding-agents/report.md",
        content: "# report",
      },
      result: { isError: true },
    });

    assertEquals(calls, []);
  });
});
