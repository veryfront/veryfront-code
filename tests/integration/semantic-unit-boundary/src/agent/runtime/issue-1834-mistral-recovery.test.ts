import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders } from "#veryfront/provider";
import { createVeryfrontCloudModel } from "#veryfront/provider/veryfront-cloud/provider.ts";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";
import { AgentRuntime } from "../../../../../../src/agent/runtime/index.ts";
import { prepareAgentRuntimeMessagesFromUiMessages } from "../../../../../../src/agent/runtime/message-preparation.ts";
import type { AgentConfig } from "../../../../../../src/agent/types.ts";
import type { Message } from "../../../../../../src/agent/schemas/index.ts";
import type { RuntimeToolFilterConfig } from "../../../../../../src/agent/runtime/runtime-tool-config.ts";

function toolCallSse(id: string, name: string, input: Record<string, unknown>): string {
  return [
    `data: ${
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id,
              type: "function",
              function: { name, arguments: JSON.stringify(input) },
            }],
          },
        }],
      })
    }`,
    'data: {"choices":[{"finish_reason":"tool_calls"}]}',
    "data: [DONE]",
    "",
  ].join("\n\n");
}

import { issue1834CapturedEmptyVertexSse } from "../../provider/veryfront-cloud/issue-1834-recorded-context.fixture.ts";

const finalTextSse =
  'data: {"choices":[{"delta":{"content":"Updated src/example.ts."}}]}\n\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

afterEach(() => {
  restoreMockFetch();
  clearModelProviders();
  deleteEnv("VERYFRONT_API_TOKEN");
  deleteEnv("VERYFRONT_PROJECT_SLUG");
});

it("recovers the recorded Mistral tool-search then empty-stop sequence", async () => {
  setEnv("VERYFRONT_API_TOKEN", "vf_test_issue_1834");
  setEnv("VERYFRONT_PROJECT_SLUG", "issue-1834-project");
  const bodies: Array<Record<string, unknown>> = [];
  const responses = [
    [
      'data: {"choices":[{"delta":{"content":"I will update the file."}}]}',
      toolCallSse("search002", "tool_search", { query: "update_file" }),
    ].join("\n\n"),
    issue1834CapturedEmptyVertexSse,
    toolCallSse("update001", "update_file", {
      path: "src/example.ts",
      str_replace: { old_string: "before", new_string: "after" },
    }),
    finalTextSse,
    'data: {"choices":[{"delta":{"content":"Follow-up complete."}}]}\n\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  ];
  installMockFetch(async (input, init) => {
    const request = new Request(input, init);
    if (!request.url.includes("/ai/v1/chat/completions")) {
      return new Response('{"tools":[]}', {
        headers: { "content-type": "application/json" },
      });
    }
    bodies.push(await request.json());
    return new Response(responses[bodies.length - 1], {
      headers: { "content-type": "text/event-stream" },
    });
  });

  const recoveryFileMarker = "ISSUE_1834_RECOVERY_FILE_EVIDENCE";
  const prepared = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      {
        id: "user00001",
        role: "user",
        parts: [{ type: "text", text: "Review src/example.ts." }],
      },
      {
        id: "assist001",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "get_file",
          toolCallId: "read00001",
          state: "output-available",
          input: { path: "src/example.ts" },
          output: {
            path: "src/example.ts",
            content: `${recoveryFileMarker}\n${"export const value = 1;\n".repeat(32)}`,
            checksum: "checksum-recovery-v1",
            version_id: "version-recovery-v1",
          },
        }, { type: "text", text: "I found the requested edit." }],
      },
      {
        id: "user00002",
        role: "user",
        parts: [{ type: "text", text: "Apply it now." }],
      },
    ],
  });
  let executions = 0;
  const model = createVeryfrontCloudModel("mistral/mistral-small-2503");
  const runtimeConfig = {
    model: "mistral/mistral-small-2503",
    system: "Update the requested project file and report completion.",
    skills: false,
    tools: {
      update_file: tool({
        id: "update_file",
        description: "Update a project file",
        inputSchema: defineSchema((v) =>
          v.object({
            path: v.string(),
            str_replace: v.object({ old_string: v.string(), new_string: v.string() }),
          })
        )(),
        execute: ({ path }) => {
          executions++;
          return { success: true, path };
        },
      }),
    },
    maxSteps: 4,
    __vfToolLoadingMode: "deferred",
  } as AgentConfig & RuntimeToolFilterConfig;
  const createRuntime = () =>
    new AgentRuntime("issue-1834-mistral-recovery", runtimeConfig, {
      resolveModelRuntime: () => model,
    });
  const runtime = createRuntime();

  let completedMessages: Message[] | undefined;
  const response = await runtime.stream(prepared, undefined, {
    onFinish: (finished) => {
      completedMessages = finished.messages;
    },
  });
  const body = await new Response(response).text();

  assertEquals(bodies.length, 4);
  assertEquals(executions, 1);
  assertStringIncludes(body, "Updated src/example.ts.");
  assertEquals(body.includes('"type":"error"'), false);
  assertStringIncludes(JSON.stringify(bodies[2]), recoveryFileMarker);

  const emptyRequestMessages = bodies[1]?.messages as Array<Record<string, unknown>>;
  const searchCallIds = emptyRequestMessages.flatMap((message) =>
    message.role === "assistant" && Array.isArray(message.tool_calls)
      ? (message.tool_calls as Array<{ id: string }>).map((call) => call.id)
      : []
  );
  const searchResult = emptyRequestMessages.find((message) =>
    message.role === "tool" && message.tool_call_id === "search002"
  );
  assertEquals(searchCallIds.includes("search002"), true);
  assertEquals(searchResult?.tool_call_id, "search002");
  assertEquals(
    (bodies[1]?.tools as Array<{ function: { name: string } }>).map((entry) => entry.function.name)
      .includes("update_file"),
    true,
  );

  assertEquals(completedMessages !== undefined, true);
  const followUp = await createRuntime().generate([
    ...(completedMessages ?? []),
    {
      id: "user00003",
      role: "user",
      parts: [{ type: "text", text: "Make one more related edit." }],
      timestamp: 10,
    },
  ]);
  assertEquals(followUp.text, "Follow-up complete.");
  assertEquals(bodies.length, 5);
  assertStringIncludes(JSON.stringify(bodies[4]), recoveryFileMarker);
});

it("retains the preceding file evidence through preparation and the Mistral edit request", async () => {
  setEnv("VERYFRONT_API_TOKEN", "vf_test_issue_1834");
  setEnv("VERYFRONT_PROJECT_SLUG", "issue-1834-project");
  const fileMarker = "ISSUE_1834_SANITIZED_FILE_BODY";
  const fileContent = `${fileMarker}\n${"export const retained = true;\n".repeat(32)}`;
  const prepared = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      {
        id: "user00001",
        role: "user",
        parts: [{ type: "text", text: "Review src/example.ts and propose the requested edit." }],
      },
      {
        id: "assist001",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "get_file",
          toolCallId: "read00001",
          state: "output-available",
          input: { path: "src/example.ts", project_reference: "example-project" },
          output: {
            path: "src/example.ts",
            content: fileContent,
            checksum: "checksum-example-v1",
            version_id: "version-example-v1",
          },
        }, {
          type: "text",
          text: "I would replace the retained constant without changing the module interface.",
        }],
      },
      {
        id: "user00002",
        role: "user",
        parts: [{ type: "text", text: "Apply that edit now." }],
      },
    ],
  });
  const preparedJson = JSON.stringify(prepared);
  assertStringIncludes(preparedJson, fileMarker);
  assertStringIncludes(preparedJson, "checksum-example-v1");
  assertStringIncludes(preparedJson, "version-example-v1");

  const bodies: Array<Record<string, unknown>> = [];
  const responses = [
    toolCallSse("search003", "tool_search", { query: "update_file" }),
    toolCallSse("update002", "update_file", {
      path: "src/example.ts",
      project_reference: "example-project",
      expected_checksum: "checksum-example-v1",
      expected_version_id: "version-example-v1",
      str_replace: { old_string: "retained = true", new_string: "retained = false" },
    }),
    finalTextSse,
  ];
  installMockFetch(async (input, init) => {
    const request = new Request(input, init);
    if (!request.url.includes("/ai/v1/chat/completions")) {
      return new Response('{"tools":[]}', {
        headers: { "content-type": "application/json" },
      });
    }
    bodies.push(await request.json());
    return new Response(responses[bodies.length - 1], {
      headers: { "content-type": "text/event-stream" },
    });
  });

  let executions = 0;
  const model = createVeryfrontCloudModel("mistral/mistral-small-2503");
  const runtime = new AgentRuntime(
    "issue-1834-retained-file-evidence",
    {
      model: "mistral/mistral-small-2503",
      system: "Apply the requested project file edit.",
      skills: false,
      tools: {
        update_file: tool({
          id: "update_file",
          description: "Update a project file",
          inputSchema: defineSchema((v) =>
            v.object({
              path: v.string(),
              project_reference: v.string(),
              expected_checksum: v.string(),
              expected_version_id: v.string(),
              str_replace: v.object({ old_string: v.string(), new_string: v.string() }),
            })
          )(),
          execute: (input) => {
            executions++;
            assertEquals(input.path, "src/example.ts");
            assertEquals(input.project_reference, "example-project");
            assertEquals(input.expected_checksum, "checksum-example-v1");
            assertEquals(input.expected_version_id, "version-example-v1");
            return { success: true, path: input.path };
          },
        }),
      },
      maxSteps: 3,
      __vfToolLoadingMode: "deferred",
    } as AgentConfig & RuntimeToolFilterConfig,
    { resolveModelRuntime: () => model },
  );

  const stream = await runtime.stream(prepared);
  const body = await new Response(stream).text();

  assertEquals(bodies.length, 3);
  assertEquals(executions, 1);
  assertStringIncludes(body, "Updated src/example.ts.");
  const firstRequest = JSON.stringify(bodies[0]);
  assertStringIncludes(firstRequest, fileMarker);
  assertStringIncludes(firstRequest, "checksum-example-v1");
  assertStringIncludes(firstRequest, "version-example-v1");
});
