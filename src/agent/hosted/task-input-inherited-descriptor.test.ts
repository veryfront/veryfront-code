import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  acceptInheritedRunAdmission,
  hostedInheritedTaskInput,
  transferHostedTerminalAuthority,
} from "./terminal-credential.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { encodeHostedTaskInput, getVerifiedHostedTaskInput } from "./task-input.ts";
const project = "11111111-1111-4111-8111-111111111111",
  child = "22222222-2222-4222-8222-222222222222",
  generation = "33333333-3333-4333-8333-333333333333";
const binding = {
  projectId: project,
  parentRunId: project,
  agentId: "disposition-agent",
  apiUrl: "http://localhost:1",
  fetch: globalThis.fetch,
};
const input = {
  version: 1 as const,
  projectId: project,
  rootRunId: "root",
  runId: "child",
  payload: {
    email_directory: "qualification/synthetic",
    artifact: {
      path: "qualification/synthetic/classified.json",
      version_id: child,
      sha256: "a".repeat(64),
      size_bytes: 2,
    },
  },
};
function response(taskInput?: unknown) {
  if (arguments.length === 0) taskInput = input;
  return Response.json({
    version: 1,
    canonicalRunId: child,
    parentRunId: project,
    projectId: project,
    agentId: binding.agentId,
    status: "running",
    conversationId: project,
    outputMessageId: child,
    dispatchNonce: generation,
    ...(taskInput !== undefined ? { taskInput } : {}),
  }, {
    headers: {
      "Content-Type": "application/vnd.veryfront.inherited-run+json",
      "Cache-Control": "no-store",
      "X-Veryfront-Run-Terminal-Token": `header.${
        btoa(
          JSON.stringify({
            runId: "child",
            canonicalRunId: child,
            dispatchNonce: generation,
            tokenUse: "run_event_writer",
            writerPurpose: "current_run_terminal",
          }),
        )
      }.signature`,
      "X-Veryfront-Run-Invocation-Token": "invocation",
      "X-Veryfront-Run-Renewal-Token": "renewal",
      "X-Veryfront-Run-Event-Token": "events",
      "X-Veryfront-Run-Event-Sequence": "12",
      "X-Veryfront-Run-External-Event-Sequence": "0",
    },
  });
}
it("retains only signed admitted child input privately and transfers it to recreated descriptor", async () => {
  const verification = {
    verified: true,
    taskInputSha256: await computeHash(encodeHostedTaskInput(input)),
    taskInputRootRunId: "root",
  };
  let calls = 0;
  const run = await acceptInheritedRunAdmission(response(), {
    ...binding,
    verifyRunEventAppendToken: async (actual) => {
      calls++;
      assertEquals(actual, { token: "events", projectId: project, runId: "child" });
      return verification;
    },
  });
  assertEquals(calls, 1);
  assertEquals(JSON.stringify(run).includes("email_directory"), false);
  const descriptor = { childRunId: run.runId };
  transferHostedTerminalAuthority(run, descriptor);
  assertEquals(hostedInheritedTaskInput(descriptor, project), input);
  const verifiedContext = {
    projectId: project,
    rootRunId: "root",
    runId: "child",
    taskInput: hostedInheritedTaskInput(descriptor, project),
  };
  assertEquals(getVerifiedHostedTaskInput(verifiedContext), input);
  for (
    const changed of [
      { ...verifiedContext, projectId: child },
      { ...verifiedContext, runId: "foreign" },
      { ...verifiedContext, rootRunId: "foreign" },
      { ...verifiedContext, taskInput: JSON.parse(JSON.stringify(input)) },
    ]
  ) {
    let refused = false;
    try {
      getVerifiedHostedTaskInput(changed);
    } catch {
      refused = true;
    }
    assertEquals(refused, true);
  }
  input.payload.email_directory = "caller-mutated";
  assertEquals(
    hostedInheritedTaskInput(descriptor, project)?.payload.email_directory,
    "qualification/synthetic",
  );
  input.payload.email_directory = "qualification/synthetic";
  assertEquals(hostedInheritedTaskInput({ childRunId: "child" }, project), undefined);
});
it("rejects missing verifier, unsigned data, wrong digest, wrong root and missing body", async () => {
  await assertRejects(() => acceptInheritedRunAdmission(response(), binding));
  for (
    const verification of [{ verified: false }, { verified: true }, {
      verified: true,
      taskInputSha256: "b".repeat(64),
      taskInputRootRunId: "root",
    }, {
      verified: true,
      taskInputSha256: await computeHash(encodeHostedTaskInput(input)),
      taskInputRootRunId: "foreign",
    }]
  ) {
    await assertRejects(() =>
      acceptInheritedRunAdmission(response(), {
        ...binding,
        verifyRunEventAppendToken: async () => verification,
      })
    );
  }
  await assertRejects(() =>
    acceptInheritedRunAdmission(response(undefined), {
      ...binding,
      verifyRunEventAppendToken: async () => ({
        verified: true,
        taskInputSha256: "a".repeat(64),
        taskInputRootRunId: "root",
      }),
    })
  );
});
it("rejects child binding that names another run or project", async () => {
  for (const taskInput of [{ ...input, runId: "foreign" }, { ...input, projectId: child }]) {
    await assertRejects(() =>
      acceptInheritedRunAdmission(response(taskInput), {
        ...binding,
        verifyRunEventAppendToken: async () => ({ verified: true }),
      })
    );
  }
});
