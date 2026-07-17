import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { type ModelRuntime } from "#veryfront/provider";
import { type RemoteToolSource, tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { agent } from "../index.ts";
import type {
  AgentConfig,
  AgentResponse,
  Message,
  RuntimeStateRequest,
  ToolExecutionResultRequest,
} from "../types.ts";
import type { RuntimeRemoteToolConfig } from "./mcp-server-tool-sources.ts";

function createRuntimeStream(parts: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });
}

function extractSystemPrompt(options: unknown): string {
  const prompt = (options as { prompt?: Array<{ role?: string; content?: unknown }> })
    .prompt;
  if (!Array.isArray(prompt)) {
    return "";
  }

  return prompt
    .filter((entry) => entry?.role === "system" && typeof entry.content === "string")
    .map((entry) => entry.content as string)
    .join("\n");
}

function supplierInvoiceEvidenceMessages(): Message[] {
  return [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Process open supplier invoices" }],
      timestamp: 1,
    },
    {
      id: "assistant-ingest",
      role: "assistant",
      parts: [{
        type: "tool-invoke_agent",
        toolCallId: "invoke-ingest-1",
        toolName: "invoke_agent",
        args: {
          agent_id: "ingest-invoice-agent",
          prompt: "Load open supplier invoices",
        },
      }],
      timestamp: 2,
    },
    {
      id: "tool-ingest",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: "invoke-ingest-1",
        toolName: "invoke_agent",
        result: {
          status: "completed",
          summary: {
            text: "Ingestion complete. 2 open invoices loaded:\n\n" +
              "| Invoice | Supplier | Route |\n" +
              "| --- | --- | --- |\n" +
              "| INV-2026-00482 | Alpine Claims Services | Escalation (blocked) |\n" +
              "| INV-2026-00491 | Meyer Papier GmbH | Matching (valid) |\n",
          },
        },
      }],
      timestamp: 3,
    },
  ];
}

describe("agent runtime refresh hooks", () => {
  it("continues suppressed unavailable tool calls with a user recovery turn after assistant text", async () => {
    const observedPrompts: Array<Array<{ role?: string; content?: unknown }>> = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/suppressed-tool-recovery",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        callCount++;
        observedPrompts.push(
          (options as { prompt?: Array<{ role?: string; content?: unknown }> }).prompt ?? [],
        );

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              { type: "text-delta", text: "I will reload the skill." },
              { type: "tool-input-start", id: "tc-stale", toolName: "load_skill" },
              { type: "tool-input-delta", id: "tc-stale", delta: '{"skillId":"create-agent"}' },
              { type: "tool-input-end", id: "tc-stale" },
              {
                type: "tool-call",
                toolCallId: "tc-stale",
                toolName: "load_skill",
                input: { skillId: "create-agent" },
              },
              { type: "finish", finishReason: "tool-calls" },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "Recovered." },
            { type: "finish", finishReason: "stop" },
          ]),
        };
      },
    };

    const assistant = agent({
      model: "hosted/suppressed-tool-recovery",
      system: "Recover from stale tools.",
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    await (await assistant.stream({ input: "Build an agent" })).toDataStreamResponse().text();

    assertEquals(callCount, 2);
    const retryPrompt = observedPrompts[1] ?? [];
    assertEquals(retryPrompt.at(-1)?.role, "user");
    assertEquals(
      JSON.stringify(retryPrompt.at(-1)?.content).includes(
        "ignored unavailable tool call(s): load_skill",
      ),
      true,
    );
  });

  it("notifies configured hooks after generate() executes a tool", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/tool-result-generate",
      async doGenerate() {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "write-1",
            toolName: "write_report",
            input: '{"path":"research/report.md"}',
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return {
          stream: createRuntimeStream([{
            type: "finish",
            finishReason: "stop",
          }]),
        };
      },
    };

    const writeReport = tool({
      id: "write_report",
      description: "Write a report",
      inputSchema: defineSchema((v) => v.object({ path: v.string() }))(),
      execute: async ({ path }, context) => ({
        path: `canonical/${path}`,
        projectId: context?.projectId,
      }),
    });

    const assistant = agent({
      model: "hosted/tool-result-generate",
      system: "Generate tool result hook test",
      tools: { write_report: writeReport },
      maxSteps: 1,
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    await assistant.generate({
      input: "Write a report",
      context: { projectId: "project-generate" },
    });

    assertEquals(toolResults.length, 1);
    assertEquals(toolResults[0]?.toolName, "write_report");
    assertEquals(toolResults[0]?.toolCallId, "write-1");
    assertEquals(toolResults[0]?.input, { path: "research/report.md" });
    assertEquals(toolResults[0]?.result, {
      path: "canonical/research/report.md",
      projectId: "project-generate",
    });
    assertEquals(toolResults[0]?.context?.projectId, "project-generate");
  });

  it("classifies structured errors returned during generate()", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "update-agent-generate-error-1",
              toolName: "update_agent",
              input: '{"id":"jira-agent"}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: [{ type: "text", text: "I can retry with the required input." }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return {
          stream: createRuntimeStream([{ type: "finish", finishReason: "stop" }]),
        };
      },
    };

    const updateError = {
      error: "tool_error",
      message: "Invalid input - system: system or system_prompt is required",
    };
    const updateAgent = tool({
      id: "update_agent",
      description: "Update a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: () => updateError,
    });

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Update agents and recover from failed tool calls.",
      tools: { update_agent: updateAgent },
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = await assistant.generate({
      input: "Attach the project skill to my Jira agent",
    });

    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[1]?.includes("update_agent"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_fetch"), true);
    assertEquals(response.toolCalls[0]?.status, "error");
    assertEquals(response.toolCalls[0]?.error, updateError.message);
    assertEquals(response.toolCalls[0]?.result, updateError);
  });

  it("forces a final response after create_agent succeeds during generate()", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "create-agent-generate-1",
              toolName: "create_agent",
              input: '{"id":"gmail-assistant-e2e"}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: [{ type: "text", text: "Created Gmail Assistant." }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return {
          stream: createRuntimeStream([{ type: "finish", finishReason: "stop" }]),
        };
      },
    };

    const createAgent = tool({
      id: "create_agent",
      description: "Create a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: async ({ id }) => ({
        id,
        name: "Gmail Assistant",
        source_path: `agents/${id}.ts`,
      }),
    });

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Create agents and summarize successful tool results.",
      tools: { create_agent: createAgent },
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    await assistant.generate({ input: "Create a Gmail agent" });

    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("create_agent"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_fetch"), true);
    assertEquals(toolNamesByStep[1], []);
  });

  it("removes provider-native tools from the forced final response after create_agent", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "create-agent-1",
                toolName: "create_agent",
                input: '{"id":"gmail-assistant-e2e"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "Created Gmail Assistant." },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const createAgent = tool({
      id: "create_agent",
      description: "Create a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: async ({ id }) => ({
        id,
        name: "Gmail Assistant",
        source_path: `agents/${id}.ts`,
      }),
    });

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Create agents and summarize successful tool results.",
      tools: { create_agent: createAgent },
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Create a Gmail agent",
    })).toDataStreamResponse();

    await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("create_agent"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_fetch"), true);
    assertEquals(toolNamesByStep[1], []);
  });

  for (const agentWriteToolName of ["create_agent", "update_agent"] as const) {
    it(`keeps follow-up project tools available after ${agentWriteToolName} for scheduled-agent flows`, async () => {
      const toolNamesByStep: string[][] = [];
      const executedTools: string[] = [];
      let callCount = 0;
      const model: ModelRuntime = {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        async doGenerate() {
          return {
            content: [{ type: "text", text: "unused" }],
            finishReason: "stop",
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        },
        async doStream(options) {
          const rawTools = (options as { tools?: unknown }).tools;
          const toolNames = Array.isArray(rawTools)
            ? rawTools.map((entry) =>
              (entry as { name?: string; id?: string }).name ??
                (entry as { name?: string; id?: string }).id ?? ""
            )
            : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
          toolNamesByStep.push(toolNames);
          callCount++;

          if (callCount === 1) {
            return {
              stream: createRuntimeStream([
                {
                  type: "tool-call",
                  toolCallId: "agent-write-1",
                  toolName: agentWriteToolName,
                  input: '{"id":"hourly-triage-agent"}',
                },
                {
                  type: "finish",
                  finishReason: "tool-calls",
                  usage: { inputTokens: 1, outputTokens: 1 },
                },
              ]),
            };
          }

          if (callCount === 2 && toolNames.includes("create_schedule")) {
            return {
              stream: createRuntimeStream([
                {
                  type: "tool-call",
                  toolCallId: "create-schedule-1",
                  toolName: "create_schedule",
                  input: JSON.stringify({
                    target: {
                      kind: "agent",
                      id: "hourly-triage-agent",
                      conversation_mode: "create_new",
                    },
                    schedule: "0 * * * *",
                    timezone: "Europe/Berlin",
                    config: {
                      prompt: "Check project status and report whether any tasks need attention.",
                    },
                  }),
                },
                {
                  type: "finish",
                  finishReason: "tool-calls",
                  usage: { inputTokens: 1, outputTokens: 1 },
                },
              ]),
            };
          }

          return {
            stream: createRuntimeStream([
              { type: "text-delta", text: "Scheduled agent created." },
              {
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        },
      };

      const agentWriteTool = tool({
        id: agentWriteToolName,
        description: agentWriteToolName === "create_agent"
          ? "Create a Studio project agent"
          : "Update a Studio project agent",
        inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        execute: async ({ id }) => {
          executedTools.push(agentWriteToolName);
          return {
            id,
            name: "Hourly Triage Agent",
            source_path: `agents/${id}.ts`,
          };
        },
      });

      const createSchedule = tool({
        id: "create_schedule",
        description: "Create a Studio schedule",
        inputSchema: defineSchema((v) =>
          v.object({
            target: v.object({
              kind: v.literal("agent"),
              id: v.string(),
              conversation_mode: v.string(),
            }),
            schedule: v.string(),
            timezone: v.string(),
            config: v.object({ prompt: v.string() }),
          })
        )(),
        execute: async ({ target, schedule, timezone }) => {
          executedTools.push("create_schedule");
          return {
            id: "schedule-hourly-triage",
            status: "active",
            target,
            schedule,
            timezone,
          };
        },
      });

      const assistant = agent({
        model: "anthropic/claude-sonnet-4-6",
        system:
          `Create scheduled agents. After ${agentWriteToolName} succeeds, call create_schedule before final output.`,
        tools: {
          [agentWriteToolName]: agentWriteTool,
          create_schedule: createSchedule,
        },
        providerTools: ["web_search", "web_fetch"],
        maxSteps: 4,
        resolveModelTransport: async () => ({ model }),
      });

      const response = (await assistant.stream({
        input: "Create or update an agent and schedule it hourly.",
      })).toDataStreamResponse();

      await response.text();
      assertEquals(toolNamesByStep[0]?.includes(agentWriteToolName), true);
      assertEquals(toolNamesByStep[0]?.includes("create_schedule"), true);
      assertEquals(toolNamesByStep[0]?.includes("web_search"), true);
      assertEquals(toolNamesByStep[0]?.includes("web_fetch"), true);
      assertEquals(toolNamesByStep[1], ["create_schedule"]);
      assertEquals(toolNamesByStep.length, 3);
      assertEquals(executedTools, [agentWriteToolName, "create_schedule"]);
    });
  }

  it("keeps tools available after a failed create_agent attempt", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "create-agent-1",
                toolName: "create_agent",
                input: '{"id":"gmail-assistant-e2e"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "I can retry with corrected agent input." },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const createAgent = tool({
      id: "create_agent",
      description: "Create a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: () => {
        throw new Error("Agent already exists");
      },
    });

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Create agents and recover from failed tool calls.",
      tools: { create_agent: createAgent },
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Create a Gmail agent",
    })).toDataStreamResponse();

    await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("create_agent"), true);
    assertEquals(toolNamesByStep[1]?.includes("create_agent"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_fetch"), true);
  });

  it("keeps tools available after update_agent returns a structured error", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    let finishedResponse: AgentResponse | undefined;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "update-agent-error-1",
                toolName: "update_agent",
                input: '{"id":"jira-agent"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "I can retry with the required input." },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const updateError = {
      error: "tool_error",
      message: "Invalid input - system: system or system_prompt is required",
    };
    const updateAgent = tool({
      id: "update_agent",
      description: "Update a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: () => updateError,
    });

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Update agents and recover from failed tool calls.",
      tools: { update_agent: updateAgent },
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Attach the project skill to my Jira agent",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();

    const streamBody = await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("update_agent"), true);
    assertEquals(toolNamesByStep[1]?.includes("update_agent"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[1]?.includes("web_fetch"), true);
    assertEquals(streamBody.includes('"type":"tool-output-error"'), true);
    assertEquals(streamBody.includes('"type":"tool-output-available"'), false);
    assertEquals(streamBody.includes(updateError.message), true);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.toolCalls[0]?.status, "error");
    assertEquals(finishedResponse.toolCalls[0]?.error, updateError.message);
    assertEquals(finishedResponse.toolCalls[0]?.result, updateError);
  });

  it("streams integration authentication actions without flattening their structured output", async () => {
    let callCount = 0;
    let finishedResponse: AgentResponse | undefined;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "gmail-list-emails-auth-1",
                toolName: "gmail__list_emails",
                input: {},
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "Connect Gmail to continue." },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };
    const authenticationRequired = {
      error: "authentication_required",
      integration: "gmail",
      connectUrl: "https://api.example.test/oauth/connect/gmail?projectId=project-1",
      message: "Authentication required for Gmail.",
    };
    const gmailSource: RemoteToolSource = {
      id: "gmail",
      listTools: () =>
        Promise.resolve([{
          name: "gmail__list_emails",
          description: "List Gmail messages",
          parameters: { type: "object", properties: {} },
        }]),
      executeTool: () => Promise.resolve(authenticationRequired),
    };
    const assistant = agent(
      {
        model: "anthropic/claude-sonnet-4-6",
        system: "Use Gmail when requested.",
        tools: { gmail__list_emails: true },
        __vfRemoteToolSources: [gmailSource],
        __vfAllowedRemoteTools: ["gmail__list_emails"],
        maxSteps: 2,
        resolveModelTransport: async () => ({ model }),
      } as AgentConfig & RuntimeRemoteToolConfig,
    );

    const response = (await assistant.stream({
      input: "Summarize my inbox",
      onFinish: (result) => {
        finishedResponse = result;
      },
    })).toDataStreamResponse();
    const streamBody = await response.text();

    assertEquals(callCount, 2);
    assertEquals(streamBody.includes('"type":"tool-output-available"'), true);
    assertEquals(streamBody.includes('"type":"tool-output-error"'), false);
    assertEquals(streamBody.includes('"error":"authentication_required"'), true);
    assertEquals(streamBody.includes(authenticationRequired.connectUrl), true);
    assertExists(finishedResponse);
    assertEquals(finishedResponse.toolCalls[0]?.status, "completed");
    assertEquals(finishedResponse.toolCalls[0]?.result, authenticationRequired);
  });

  it("keeps skill file tools hidden after a failed load_skill attempt", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "load-missing-skill",
                toolName: "load_skill",
                input: '{"skillId":"missing"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "I could not load that skill." },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const loadSkill = tool({
      id: "load_skill",
      description: "Load a skill",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: () => ({ error: "Skill not found" }),
    });
    const loadSkillReference = tool({
      id: "load_skill_reference",
      description: "Load a skill reference",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string(), reference: v.string() }))(),
      execute: () => ({ content: "reference" }),
    });

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Recover from a missing skill.",
      tools: {
        load_skill: loadSkill,
        load_skill_reference: loadSkillReference,
      },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Load the missing skill",
    })).toDataStreamResponse();

    await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("load_skill"), true);
    assertEquals(toolNamesByStep[0]?.includes("load_skill_reference"), false);
    assertEquals(toolNamesByStep[1]?.includes("load_skill"), true);
    assertEquals(toolNamesByStep[1]?.includes("load_skill_reference"), false);
  });

  it("removes provider-native tools from the forced final response after update_agent", async () => {
    const toolNamesByStep: string[][] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options) {
        const rawTools = (options as { tools?: unknown }).tools;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((entry) =>
            (entry as { name?: string; id?: string }).name ??
              (entry as { name?: string; id?: string }).id ?? ""
          )
          : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {});
        toolNamesByStep.push(toolNames);
        callCount++;

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "update-agent-1",
                toolName: "update_agent",
                input: '{"id":"gmail-assistant-e2e"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "Updated Gmail Assistant." },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const updateAgent = tool({
      id: "update_agent",
      description: "Update a Studio project agent",
      inputSchema: defineSchema((v) => v.object({ id: v.string() }))(),
      execute: async ({ id }) => ({
        id,
        name: "Gmail Assistant",
        source_path: `agents/${id}.ts`,
      }),
    });

    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Update agents and summarize successful tool results.",
      tools: { update_agent: updateAgent },
      providerTools: ["web_search", "web_fetch"],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      input: "Update my Gmail agent",
    })).toDataStreamResponse();

    await response.text();
    assertEquals(toolNamesByStep.length, 2);
    assertEquals(toolNamesByStep[0]?.includes("update_agent"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_search"), true);
    assertEquals(toolNamesByStep[0]?.includes("web_fetch"), true);
    assertEquals(toolNamesByStep[1], []);
  });

  it("notifies configured hooks after stream() executes a tool", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/tool-result-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "write-stream-1",
                toolName: "write_report",
                input: '{"path":"research/stream-report.md"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "stream complete" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const writeReport = tool({
      id: "write_report",
      description: "Write a report",
      inputSchema: defineSchema((v) => v.object({ path: v.string() }))(),
      execute: async ({ path }, context) => ({
        path: `canonical/${path}`,
        projectId: context?.projectId,
      }),
    });

    const assistant = agent({
      model: "hosted/tool-result-stream",
      system: "Stream tool result hook test",
      tools: { write_report: writeReport },
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    const response = (await assistant.stream({
      input: "Write a report",
      context: { projectId: "project-stream" },
    })).toDataStreamResponse();

    await response.text();

    assertEquals(toolResults.length, 1);
    assertEquals(toolResults[0]?.toolName, "write_report");
    assertEquals(toolResults[0]?.toolCallId, "write-stream-1");
    assertEquals(toolResults[0]?.input, { path: "research/stream-report.md" });
    assertEquals(toolResults[0]?.result, {
      path: "canonical/research/stream-report.md",
      projectId: "project-stream",
    });
    assertEquals(toolResults[0]?.context?.projectId, "project-stream");
  });

  it("does not re-call the model after final assistant text with a provisional placeholder", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let callCount = 0;
    const studioSuggestions = tool({
      id: "studio_suggestions",
      description: "Capture Studio suggestions",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => ({ suggestions: [] }),
    });
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/text-placeholder-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount > 1) {
          throw new Error("unexpected second stream call");
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "Created the Outlook assistant." },
            {
              type: "tool-input-start",
              id: "toolu_placeholder_after_text",
              toolName: "studio_suggestions",
            },
            { type: "tool-input-delta", id: "toolu_placeholder_after_text", delta: "{}" },
            {
              type: "finish",
              finishReason: "tool-calls",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const assistant = agent({
      model: "hosted/text-placeholder-stream",
      system: "Placeholder recovery regression test",
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
      tools: { studio_suggestions: studioSuggestions },
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    const response = (await assistant.stream({
      input: "Create an Outlook assistant",
    })).toDataStreamResponse();
    const body = await response.text();

    assertEquals(callCount, 1);
    assertEquals(toolResults, []);
    assertEquals(body.includes("Created the Outlook assistant."), true);
  });

  it("applies loaded skill maxSteps overrides to generate() invoke_agent calls", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/skill-invoke-generate",
      async doGenerate() {
        callCount++;

        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "load-build-1",
              toolName: "load_skill",
              input: '{"skillId":"build"}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        if (callCount === 2) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "invoke-1",
              toolName: "invoke_agent",
              input:
                '{"description":"Research reference system","prompt":"Research reference docs","max_steps":10}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createRuntimeStream([{ type: "finish", finishReason: "stop" }]) };
      },
    };
    const loadSkill = tool({
      id: "load_skill",
      description: "Load a skill",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: () => ({ skillId: "build", maxSteps: 160 }),
    });
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          description: v.string(),
          prompt: v.string(),
          max_steps: v.number().optional(),
        })
      )(),
      execute: ({ max_steps }) => ({ ok: true, max_steps }),
    });
    const assistant = agent({
      model: "hosted/skill-invoke-generate",
      system: "Skill override generate test",
      tools: { load_skill: loadSkill, invoke_agent: invokeAgent },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    await assistant.generate({ input: "Build a report" });

    const invokeResult = toolResults.find((result) => result.toolName === "invoke_agent");
    assertEquals(invokeResult?.input, {
      description: "Research reference system",
      prompt: "Research reference docs",
      max_steps: 160,
    });
    assertEquals(invokeResult?.result, { ok: true, max_steps: 160 });
  });

  it("applies loaded skill maxSteps overrides to stream() invoke_agent calls", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/skill-invoke-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "load-build-stream-1",
                toolName: "load_skill",
                input: '{"skillId":"build"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        if (callCount === 2) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "invoke-stream-1",
                toolName: "invoke_agent",
                input:
                  '{"description":"Research reference system","prompt":"Research reference docs","max_steps":10}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "done" },
            { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
          ]),
        };
      },
    };
    const loadSkill = tool({
      id: "load_skill",
      description: "Load a skill",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: () => ({ skillId: "build", maxSteps: 160 }),
    });
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          description: v.string(),
          prompt: v.string(),
          max_steps: v.number().optional(),
        })
      )(),
      execute: ({ max_steps }) => ({ ok: true, max_steps }),
    });
    const assistant = agent({
      model: "hosted/skill-invoke-stream",
      system: "Skill override stream test",
      tools: { load_skill: loadSkill, invoke_agent: invokeAgent },
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });

    const response = (await assistant.stream({ input: "Build a report" })).toDataStreamResponse();
    await response.text();

    const invokeResult = toolResults.find((result) => result.toolName === "invoke_agent");
    assertEquals(invokeResult?.input, {
      description: "Research reference system",
      prompt: "Research reference docs",
      max_steps: 160,
    });
    assertEquals(invokeResult?.result, { ok: true, max_steps: 160 });
  });

  it("hydrates loaded skill delegation overrides from persisted messages before stream tool execution", async () => {
    const toolResults: ToolExecutionResultRequest[] = [];
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/skill-resume-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "invoke-resumed-1",
                toolName: "invoke_agent",
                input:
                  '{"description":"Run invoice matching","prompt":"Match invoices","max_steps":10}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "done" },
            { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
          ]),
        };
      },
    };
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          description: v.string(),
          prompt: v.string(),
          max_steps: v.number().optional(),
        })
      )(),
      execute: ({ max_steps }) => ({ ok: true, max_steps }),
    });
    const assistant = agent({
      model: "hosted/skill-resume-stream",
      system: "Skill resumed stream test",
      tools: { invoke_agent: invokeAgent },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
      onToolResult: (request) => {
        toolResults.push(request);
      },
    });
    const resumedMessages: Message[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Process invoices" }],
        timestamp: 1,
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "tool-load_skill",
          toolCallId: "load-skill-1",
          toolName: "load_skill",
          args: { skillId: "supplier-invoice-processing" },
        }],
        timestamp: 2,
      },
      {
        id: "tool-1",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "load-skill-1",
          toolName: "load_skill",
          result: {
            skillId: "supplier-invoice-processing",
            allowedTools: ["invoke_agent"],
            maxSteps: 160,
          },
        }],
        timestamp: 3,
      },
    ];

    const response = (await assistant.stream({ messages: resumedMessages })).toDataStreamResponse();
    await response.text();

    const invokeResult = toolResults.find((result) => result.toolName === "invoke_agent");
    assertEquals(invokeResult?.input, {
      description: "Run invoice matching",
      prompt: "Match invoices",
      max_steps: 160,
    });
    assertEquals(invokeResult?.result, { ok: true, max_steps: 160 });
  });

  it("does not locally block generate() invoke_agent calls that contradict prior tool output", async () => {
    let executed = false;
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/invoke-agent-evidence-generate",
      async doGenerate() {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "invoke-payment-1",
              toolName: "invoke_agent",
              input: JSON.stringify({
                agent_id: "payment-approval-agent",
                description: "Approve matched invoice INV-2026-00491 (Meridian Logistics GmbH)",
                prompt:
                  "Approve invoice INV-2026-00491 for payment. This invoice from supplier Meridian Logistics GmbH for €2,180.00 matched PO-2026-1197 with zero variance.",
              }),
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: [{ type: "text", text: "blocked" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: createRuntimeStream([{ type: "finish", finishReason: "stop" }]) };
      },
    };
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          agent_id: v.string(),
          description: v.string().optional(),
          prompt: v.string(),
        })
      )(),
      execute: () => {
        executed = true;
        return { ok: true };
      },
    });
    const assistant = agent({
      model: "hosted/invoke-agent-evidence-generate",
      system: "Supplier invoice orchestrator",
      tools: { invoke_agent: invokeAgent },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const result = await assistant.generate({
      input: supplierInvoiceEvidenceMessages(),
    });

    assertEquals(executed, true);
    assertEquals(result.toolCalls[0]?.status, "completed");
    assertEquals(result.toolCalls[0]?.result, { ok: true });
  });

  it("does not locally block stream() invoke_agent calls that contradict prior tool output", async () => {
    let executed = false;
    let callCount = 0;
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/invoke-agent-evidence-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream() {
        callCount++;
        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "invoke-payment-1",
                toolName: "invoke_agent",
                input: JSON.stringify({
                  agent_id: "payment-approval-agent",
                  description: "Approve matched invoice INV-2026-00491 (Meridian Logistics GmbH)",
                  prompt:
                    "Approve invoice INV-2026-00491 for payment. This invoice from supplier Meridian Logistics GmbH for €2,180.00 matched PO-2026-1197 with zero variance.",
                }),
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "blocked" },
            { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
          ]),
        };
      },
    };
    const invokeAgent = tool({
      id: "invoke_agent",
      description: "Invoke an agent",
      inputSchema: defineSchema((v) =>
        v.object({
          agent_id: v.string(),
          description: v.string().optional(),
          prompt: v.string(),
        })
      )(),
      execute: () => {
        executed = true;
        return { ok: true };
      },
    });
    const assistant = agent({
      model: "hosted/invoke-agent-evidence-stream",
      system: "Supplier invoice orchestrator",
      tools: { invoke_agent: invokeAgent },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    const response = (await assistant.stream({
      messages: supplierInvoiceEvidenceMessages(),
    })).toDataStreamResponse();
    const body = await response.text();

    assertEquals(executed, true);
    assertEquals(body.includes('INV-2026-00491 supplier is \\"Meyer Papier GmbH\\"'), false);
    assertEquals(body.includes("Meridian Logistics GmbH"), true);
  });

  it("refreshes system and context at step boundaries for generate()", async () => {
    const runtimeRequests: RuntimeStateRequest[] = [];
    const observedSystems: string[] = [];
    const inspectedContexts: Array<Record<string, unknown> | undefined> = [];
    let callCount = 0;

    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/runtime-refresh-generate",
      async doGenerate(options: unknown) {
        callCount++;
        observedSystems.push(extractSystemPrompt(options));

        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "switch-1",
              toolName: "switch_project",
              input: '{"projectId":"project-b"}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        if (callCount === 2) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "inspect-1",
              toolName: "inspect_context",
              input: "{}",
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return {
          stream: createRuntimeStream([{
            type: "finish",
            finishReason: "stop",
          }]),
        };
      },
    };

    const switchProject = tool({
      id: "switch_project",
      description: "Switch the active project context",
      inputSchema: defineSchema((v) => v.object({ projectId: v.string() }))(),
      execute: async ({ projectId }) => ({ projectId }),
    });

    const inspectContext = tool({
      id: "inspect_context",
      description: "Inspect the current runtime context",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async (_input, context) => {
        inspectedContexts.push(context as Record<string, unknown> | undefined);
        return {
          projectId: context?.projectId,
          steeringRevision: context?.steeringRevision,
        };
      },
    });

    const assistant = agent({
      model: "hosted/runtime-refresh-generate",
      system: "Base system prompt",
      tools: {
        switch_project: switchProject,
        inspect_context: inspectContext,
      },
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState: async (request) => {
        runtimeRequests.push(request);

        if (request.step === 0) {
          return undefined;
        }

        return {
          system: "Refreshed system prompt",
          context: {
            projectId: "project-b",
            steeringRevision: 1,
          },
        };
      },
    });

    const result = await assistant.generate({
      input: "Switch to project b and inspect the active context",
      context: { projectId: "project-a" },
    });

    assertEquals(result.text, "done");
    assertEquals(runtimeRequests.map((request) => request.step), [0, 1, 2]);
    assertEquals(observedSystems, [
      "Base system prompt",
      "Refreshed system prompt",
      "Refreshed system prompt",
    ]);

    const secondRequest = runtimeRequests[1];
    assertExists(secondRequest);
    assertEquals(secondRequest.context, { projectId: "project-a" });
    assertEquals(
      secondRequest.messages.some((message) =>
        message.role === "tool" &&
        message.parts.some((part) =>
          part.type === "tool-result" &&
          part.toolCallId === "switch-1" &&
          part.toolName === "switch_project"
        )
      ),
      true,
    );

    assertEquals(inspectedContexts.length, 1);
    assertEquals(inspectedContexts[0]?.projectId, "project-b");
    assertEquals(inspectedContexts[0]?.steeringRevision, 1);
  });

  it("refreshes the streaming system prompt between hosted run steps", async () => {
    const runtimeRequests: RuntimeStateRequest[] = [];
    const observedSystems: string[] = [];
    let callCount = 0;

    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/runtime-refresh-stream",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "unused" }],
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
      async doStream(options: unknown) {
        callCount++;
        observedSystems.push(extractSystemPrompt(options));

        if (callCount === 1) {
          return {
            stream: createRuntimeStream([
              {
                type: "tool-call",
                toolCallId: "switch-stream-1",
                toolName: "switch_project",
                input: '{"projectId":"project-b"}',
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]),
          };
        }

        return {
          stream: createRuntimeStream([
            { type: "text-delta", text: "stream done" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
            },
          ]),
        };
      },
    };

    const switchProject = tool({
      id: "switch_project",
      description: "Switch the active project context",
      inputSchema: defineSchema((v) => v.object({ projectId: v.string() }))(),
      execute: async ({ projectId }) => ({ projectId }),
    });

    const assistant = agent({
      model: "hosted/runtime-refresh-stream",
      system: "Base streaming system prompt",
      tools: { switch_project: switchProject },
      resolveModelTransport: async () => ({ model }),
      resolveRuntimeState: async (request) => {
        runtimeRequests.push(request);

        if (request.step === 0) {
          return undefined;
        }

        return {
          system: "Refreshed streaming system prompt",
          context: { projectId: "project-b" },
        };
      },
    });

    const response = (await assistant.stream({
      input: "Switch to project b",
      context: { projectId: "project-a" },
    })).toDataStreamResponse();

    const body = await response.text();

    assertEquals(runtimeRequests.map((request) => request.step), [0, 1]);
    assertEquals(observedSystems, [
      "Base streaming system prompt",
      "Refreshed streaming system prompt",
    ]);
    assertEquals(body.includes("stream done"), true);
  });
});
