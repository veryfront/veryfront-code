import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { encodeHostedTaskInput, snapshotHostedTaskInput } from "./task-input.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildHostedChatRequestInputFromRuntimeAgentInvocation } from "./chat-request.ts";
import {
  parseHostedChatRequestFromRequest,
  parseRuntimeAgentRunInvocationHostedChatRequestFromRequest,
} from "./chat-request-parser.ts";
import type { RuntimeAgentRunInvocation } from "../runtime/agent-invocation-contract.ts";
const projectId = "10000000-1000-4000-8000-100000000005",
  userId = "10000000-1000-4000-8000-100000000004";
const taskInput = {
  version: 1 as const,
  projectId,
  rootRunId: "run_root",
  runId: "run_child",
  payload: { intakeId: "synthetic-intake" },
};
const source = { type: "release", releaseId: "release-42" } as const;
const invocation = {
  run: {
    agentServiceId: "runtime-provider",
    agentId: "disposition-agent",
    conversationId: "10000000-1000-4000-8000-100000000001",
    runId: "run_child",
    messageId: "10000000-1000-4000-8000-100000000002",
    inputAnchorMessageId: "10000000-1000-4000-8000-100000000003",
    requestedByUserId: userId,
    project: {
      projectId,
      projectSlug: "synthetic-project",
      runtimeTargetKind: "main_branch" as const,
    },
    parentRunId: "run_root",
  },
  messages: [],
  tools: [],
  context: [],
  agentSource: source,
  taskInput,
};
const principal = {
  authenticate: () => Promise.resolve({ userId, authToken: "synthetic-user-token" }),
  verifyProjectAccess: () => Promise.resolve({ success: true as const }),
  runtimeSource: source,
};
function request(body: unknown, token = true) {
  return new Request("https://agent.example.com/api/control-plane/runs/run_child/stream", {
    method: "POST",
    headers: token ? { "X-Veryfront-Run-Event-Token": "synthetic-writer-token" } : {},
    body: JSON.stringify(body),
  });
}
describe("planned native task input ingress", () => {
  it("carries explicit native task input rather than promoting advisory props", () => {
    const input = buildHostedChatRequestInputFromRuntimeAgentInvocation(
      invocation as unknown as RuntimeAgentRunInvocation,
    );
    assertEquals((input as unknown as Record<string, unknown>).taskInput, taskInput);
  });
  it("rejects typed input without a verified host envelope", async () => {
    const result = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      request(invocation, false),
      principal,
    );
    assertEquals(result instanceof Response && result.status === 403, true);
  });
  it("does not authorize typed input through a legacy bare boolean token verifier", async () => {
    const result = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      request(invocation),
      { ...principal, verifyRunEventAppendToken: () => Promise.resolve(true) },
    );
    assertEquals(result instanceof Response && result.status === 403, true);
  });
  it("rejects a body that conflicts with the signed accepted-input digest", async () => {
    const result = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      request(invocation),
      {
        ...principal,
        verifyRunEventAppendToken: () =>
          Promise.resolve({
            verified: true,
            taskInputSha256: "a".repeat(64),
            rootRunId: "run_root",
          }),
      },
    );
    assertEquals(result instanceof Response && result.status === 403, true);
  });
  it("rejects task-bound writer claims on general chat ingress", async () => {
    for (
      const claims of [
        { taskInputSha256: "a".repeat(64) },
        { taskInputRootRunId: "run_root" },
        { taskInputSha256: "a".repeat(64), taskInputRootRunId: "run_root" },
      ]
    ) {
      const result = await parseHostedChatRequestFromRequest(
        request({
          messages: [],
          context: { projectId, branchId: null },
          durableRootRun: { runId: "run_child", messageId: invocation.run.messageId },
        }),
        {
          ...principal,
          verifyRunEventAppendToken: () => Promise.resolve({ verified: true, ...claims }),
        },
      );
      assertEquals(result instanceof Response && result.status, 403);
    }
  });
  it("keeps ordinary chat bodies outside the host-owned input channel", async () => {
    const result = await parseHostedChatRequestFromRequest(
      request({ messages: [], context: { projectId, branchId: null }, taskInput }),
      principal,
    );
    assertEquals(
      result instanceof Response ||
        (result as unknown as Record<string, unknown>).serverResolvedTaskInput === undefined,
      true,
    );
  });
});

describe("verified native typed input", () => {
  async function proof() {
    return {
      verified: true,
      taskInputSha256: await computeHash(encodeHostedTaskInput(snapshotHostedTaskInput(taskInput))),
      taskInputRootRunId: "run_root",
      integrationTools: ["outlook__move_email"],
    };
  }
  it("promotes frozen accepted input and retains token grants", async () => {
    let verifications = 0;
    const result = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      request(invocation),
      {
        ...principal,
        verifyRunEventAppendToken: async () => {
          verifications++;
          return proof();
        },
      },
    );
    assertEquals(result instanceof Response, false);
    if (result instanceof Response) return;
    assertEquals(result.serverResolvedTaskInput, taskInput);
    assertEquals(Object.isFrozen(result.serverResolvedTaskInput?.payload), true);
    assertEquals(result.serverResolvedIntegrationToolNames, ["outlook__move_email"]);
    assertEquals(verifications, 1);
  });
  it("rejects claim without body before project access", async () => {
    let projectReads = 0;
    const { taskInput: _ignored, ...body } = invocation;
    const result = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(request(body), {
      ...principal,
      verifyProjectAccess: async () => {
        projectReads++;
        return { success: true as const };
      },
      verifyRunEventAppendToken: proof,
    });
    assertEquals(result instanceof Response && result.status, 403);
    assertEquals(projectReads, 0);
  });
  it("rejects post-signing payload mutation before project access", async () => {
    let projectReads = 0;
    const body = { ...invocation, taskInput: { ...taskInput, payload: { intakeId: "changed" } } };
    const result = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(request(body), {
      ...principal,
      verifyProjectAccess: async () => {
        projectReads++;
        return { success: true as const };
      },
      verifyRunEventAppendToken: proof,
    });
    assertEquals(result instanceof Response && result.status, 403);
    assertEquals(projectReads, 0);
  });
  it("rejects cross-child and cross-root bindings", async () => {
    for (
      const body of [{ ...invocation, taskInput: { ...taskInput, runId: "foreign" } }, {
        ...invocation,
        taskInput: { ...taskInput, rootRunId: "foreign" },
      }]
    ) {
      const result = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
        request(body),
        { ...principal, verifyRunEventAppendToken: proof },
      );
      assertEquals(result instanceof Response && result.status, 403);
    }
  });
  it("retains legacy absent-body absent-claim behavior", async () => {
    const { taskInput: _ignored, ...body } = invocation;
    const result = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(request(body), {
      ...principal,
      verifyRunEventAppendToken: async () => true,
    });
    assertEquals(result instanceof Response, false);
    if (!(result instanceof Response)) assertEquals(result.serverResolvedTaskInput, undefined);
  });
});

for (const rootRunId of ["run_signed_root", "", "bad/root", 42, undefined]) {
  it(`validates and retains the general-chat signed root ${JSON.stringify(rootRunId)}`, async () => {
    const result = await parseHostedChatRequestFromRequest(
      request({
        messages: [],
        context: { projectId, conversationId: invocation.run.conversationId, branchId: "branch-1" },
        durableRootRun: { runId: "run_child", messageId: invocation.run.messageId },
      }),
      {
        ...principal,
        verifyRunEventAppendToken: async () => ({
          verified: true,
          rootRunId: rootRunId as string | undefined,
        }),
      },
    );
    if (rootRunId === undefined || rootRunId === "run_signed_root") {
      if (result instanceof Response) throw new Error(await result.text());
      assertEquals(result.serverResolvedRootRunId, rootRunId);
    } else assertEquals(result instanceof Response && result.status === 403, true);
  });
}
