import {
  createHostedRunEventWriterCapability,
  persistHostedAcceptedTaskInput,
} from "#veryfront/agent/hosted/child-run-event-writer-token.ts";
import { parseRuntimeAgentRunInvocationHostedChatRequestFromRequest } from "#veryfront/agent/hosted/chat-request-parser.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  getHostedChildTaskInputResolver,
  withHostedChildTaskInputResolver,
} from "#veryfront/agent/hosted/accepted-child-input-scope.ts";
import {
  encodeHostedTaskInput,
  resolveHostedTaskInput,
} from "#veryfront/agent/hosted/task-input.ts";
import {
  type HostedAcceptedTaskInputEvent,
  snapshotHostedAcceptedTaskInputEvent,
} from "#veryfront/agent/hosted/accepted-task-input.ts";
import { assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  hostedAcceptedChildEvidence,
  registerHostedTerminalCredential,
} from "#veryfront/agent/hosted/terminal-credential.ts";
import type { ParsedHostedChatRequest } from "#veryfront/agent/hosted/chat-request-parser.ts";

it("pins both credentialed evidence readers when tenant code replaces string methods", async () => {
  const canonical = "11111111-1111-4111-8111-111111111111";
  const version = "77777777-7777-4777-8777-777777777777";
  const owner = {
    projectId: "project-1",
    authToken: "synthetic-parent-token",
    durableRootRun: { runId: "parent" },
  } as ParsedHostedChatRequest;
  registerEvidenceOwner(owner, true);
  const calls: { url: string; authorization: string | null }[] = [];
  const evidence = hostedAcceptedChildEvidence(owner, "project-1", undefined, {
    apiUrl: "https://api.example/v1///",
    fetch: (input, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(
        Response.json(
          calls.length === 1
            ? { data: [], page_info: { next: null } }
            : { path: "note.txt", id: version, content: "immutable" },
        ),
      );
    },
  });
  const original = String.prototype.replace;
  try {
    Object.defineProperty(String.prototype, "replace", {
      value: function (this: unknown, ...args: unknown[]): string {
        return String(this) === "https://api.example/v1///"
          ? "https://attacker.invalid"
          : Reflect.apply(original, this, args);
      },
    });
    await evidence.readParentToolResults();
    await evidence.readCommittedVersion("note.txt", version);
  } finally {
    String.prototype.replace = original;
  }
  assertEquals(calls, [
    {
      url:
        `https://api.example/v1/runs/${canonical}/events?event_type=TOOL_CALL_RESULT&limit=100&sort_order=desc&include_descendants=false`,
      authorization: "Bearer synthetic-parent-token",
    },
    {
      url: `https://api.example/v1/projects/project-1/files/note.txt/versions/${version}`,
      authorization: "Bearer synthetic-parent-token",
    },
  ]);
});

const receipt = (): HostedAcceptedTaskInputEvent => ({
  type: "AGENT_RUN_TASK_INPUT_ACCEPTED",
  version: 1,
  targetAgentId: "child",
  sourceEventIds: [1, 2],
  artifactVersions: [{
    path: "note",
    version_id: "11111111-1111-4111-8111-111111111111",
    sha256: "a".repeat(64),
    size_bytes: 1,
  }],
  payload: { value: "accepted" },
});

it("validates accepted receipts despite throwing tenant replacements", () => {
  const input = receipt();
  const patches: [object, string, unknown][] = [
    [Object, "keys", () => {
      throw new Error("poisoned keys");
    }],
    [Array.prototype, "sort", () => {
      throw new Error("poisoned sort");
    }],
    [Array.prototype, "some", () => {
      throw new Error("poisoned some");
    }],
    [String.prototype, "localeCompare", () => {
      throw new Error("poisoned comparison");
    }],
    [RegExp.prototype, "test", () => {
      throw new Error("poisoned test");
    }],
    [Number, "isSafeInteger", () => {
      throw new Error("poisoned integer");
    }],
  ];
  const descriptors = patches.map(([target, name]) =>
    Object.getOwnPropertyDescriptor(target, name)!
  );
  let accepted: HostedAcceptedTaskInputEvent | undefined;
  try {
    for (const [target, name, replacement] of patches) {
      Object.defineProperty(target, name, { value: replacement });
    }
    accepted = snapshotHostedAcceptedTaskInputEvent(input);
  } finally {
    patches.forEach(([target, name], index) =>
      Object.defineProperty(target, name, descriptors[index]!)
    );
  }
  assertEquals(accepted, input);
});

it("rejects malformed receipts despite permissive tenant replacements", () => {
  const input = receipt();
  const invalid = {
    ...input,
    sourceEventIds: [1.5],
    artifactVersions: [{
      ...input.artifactVersions[0]!,
      version_id: "mutable-alias",
      sha256: "invalid",
      size_bytes: 1,
    }],
  };
  const originalSome = Array.prototype.some,
    originalTest = RegExp.prototype.test,
    originalInteger = Number.isSafeInteger;
  let rejected = false;
  try {
    Array.prototype.some = () => false;
    RegExp.prototype.test = () => true;
    Number.isSafeInteger = () => true;
    try {
      snapshotHostedAcceptedTaskInputEvent(invalid);
    } catch {
      rejected = true;
    }
  } finally {
    Array.prototype.some = originalSome;
    RegExp.prototype.test = originalTest;
    Number.isSafeInteger = originalInteger;
  }
  assertEquals(rejected, true);
  assertThrows(() => snapshotHostedAcceptedTaskInputEvent(invalid));
});

it("does not skip or replace parent evidence when tenant code poisons array traversal", async () => {
  const canonical = "11111111-1111-4111-8111-111111111111";
  const owner = {
    projectId: "project-1",
    authToken: "synthetic-parent-token",
    durableRootRun: { runId: "parent" },
  } as ParsedHostedChatRequest;
  registerEvidenceOwner(owner, true);
  const valid = {
    run_id: canonical,
    event_type: "TOOL_CALL_RESULT",
    event_id: 1,
    payload: { result: "accepted" },
  };
  const responses = [
    Response.json({ data: [{ ...valid, run_id: "foreign" }], page_info: { next: null } }),
    Response.json({ data: [valid], page_info: { next: null } }),
  ];
  let index = 0;
  const evidence = hostedAcceptedChildEvidence(owner, "project-1", undefined, {
    apiUrl: "https://api.example/v1",
    fetch: () => Promise.resolve(responses[index++]!),
  });
  const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  const map = Object.getOwnPropertyDescriptor(Array.prototype, "map")!;
  let rejected = false;
  let rows: Awaited<ReturnType<typeof evidence.readParentToolResults>> | undefined;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value: function* () {},
    });
    Object.defineProperty(Array.prototype, "map", { configurable: true, value: () => [] });
    try {
      await evidence.readParentToolResults();
    } catch (error) {
      rejected = error instanceof Error &&
        error.message === "Parent receipt evidence has wrong scope";
    }
    rows = await evidence.readParentToolResults();
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
    Object.defineProperty(Array.prototype, "map", map);
  }
  assertEquals(rejected, true);
  assertEquals(rows, [valid]);
  assertEquals(Object.isFrozen(rows), true);
  assertEquals(Object.isFrozen(rows![0]), true);
});

it("validates, freezes and hashes task input with poisoned array iteration and species", () => {
  const scope = { projectId: "project-a", rootRunId: "root-a", runId: "child-a" };
  const binding = () => ({
    version: 1 as const,
    ...scope,
    payload: { intakeId: "intake-a", nested: { path: "artifact" } },
  });
  const original = {
    ...binding(),
    payload: { ...binding().payload, list: [{ value: "first" }, "second"] },
  };
  const expected = encodeHostedTaskInput(original);
  const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  const species = Object.getOwnPropertyDescriptor(Array, Symbol.species)!;
  let snapshot: ReturnType<typeof resolveHostedTaskInput>;
  let encoded: string | undefined;
  let rejected = false;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value: function* () {},
    });
    Object.defineProperty(Array, Symbol.species, {
      configurable: true,
      get() {
        throw new Error("tenant species");
      },
    });
    snapshot = resolveHostedTaskInput(original, scope);
    encoded = encodeHostedTaskInput(snapshot!);
    try {
      resolveHostedTaskInput({ ...original, runId: "foreign" }, scope);
    } catch {
      rejected = true;
    }
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
    Object.defineProperty(Array, Symbol.species, species);
  }
  assertEquals(encoded, expected);
  assertEquals(Object.isFrozen(snapshot!.payload.nested), true);
  assertEquals(rejected, true);
});

it("isolates resolver scopes when tenant code replaces async context methods", async () => {
  const getStore = Object.getOwnPropertyDescriptor(AsyncLocalStorage.prototype, "getStore")!;
  const run = Object.getOwnPropertyDescriptor(AsyncLocalStorage.prototype, "run")!;
  let injectedReads = 0;
  let legitimateCalls = 0;
  const request = {
    projectId: "project",
    parentRunId: "parent",
    targetAgentId: "child",
    toolCallId: "call",
    evidence: {
      readParentToolResults: async () => {
        injectedReads++;
        return [];
      },
      readCommittedVersion: async (path: string, versionId: string) => ({
        path,
        versionId,
        content: "victim-evidence",
      }),
    },
  };
  let error: unknown;
  try {
    Object.defineProperty(AsyncLocalStorage.prototype, "getStore", {
      configurable: true,
      value: () => ({
        active: true,
        resolver: async (input: typeof request) => {
          await input.evidence.readParentToolResults();
          return undefined;
        },
      }),
    });
    await withHostedChildTaskInputResolver(async () => {
      legitimateCalls++;
      return undefined;
    }, async () => {
      await getHostedChildTaskInputResolver()!(request);
    });
    Object.defineProperty(AsyncLocalStorage.prototype, "run", {
      configurable: true,
      value: () => {
        throw new Error("tenant run");
      },
    });
    await withHostedChildTaskInputResolver(async () => {
      legitimateCalls++;
      return undefined;
    }, async () => {
      await getHostedChildTaskInputResolver()!(request);
    });
  } catch (caught) {
    error = caught;
  } finally {
    Object.defineProperty(AsyncLocalStorage.prototype, "getStore", getStore);
    Object.defineProperty(AsyncLocalStorage.prototype, "run", run);
  }
  assertEquals(error, undefined);
  assertEquals(injectedReads, 0);
  assertEquals(legitimateCalls, 2);
});

it("keeps native root-bound ingress independent of mutable regexp test", async () => {
  const projectId = "10000000-1000-4000-8000-100000000005";
  const userId = "10000000-1000-4000-8000-100000000004";
  const source = { type: "release" as const, releaseId: "release-42" };
  const taskInput = {
    version: 1 as const,
    projectId,
    rootRunId: "run_root",
    runId: "run_child",
    payload: { intakeId: "accepted" },
  };
  const body = {
    run: {
      agentServiceId: "runtime-provider",
      agentId: "child",
      conversationId: "10000000-1000-4000-8000-100000000001",
      runId: "run_child",
      messageId: "10000000-1000-4000-8000-100000000002",
      inputAnchorMessageId: "10000000-1000-4000-8000-100000000003",
      requestedByUserId: userId,
      project: { projectId, projectSlug: "synthetic-project", runtimeTargetKind: "main_branch" },
      parentRunId: "run_root",
    },
    messages: [],
    tools: [],
    context: [],
    agentSource: source,
    taskInput,
  };
  const request = new Request("https://agent.example.com/api/control-plane/runs/run_child/stream", {
    method: "POST",
    headers: { "X-Veryfront-Run-Event-Token": "synthetic-writer-token" },
    body: JSON.stringify(body),
  });
  const invalidRequest = new Request(
    "https://agent.example.com/api/control-plane/runs/run_child/stream",
    {
      method: "POST",
      headers: { "X-Veryfront-Run-Event-Token": "synthetic-writer-token" },
      body: JSON.stringify({ ...body, taskInput: undefined }),
    },
  );
  let invalidResult:
    | Awaited<ReturnType<typeof parseRuntimeAgentRunInvocationHostedChatRequestFromRequest>>
    | undefined;
  const digest = await computeHash(encodeHostedTaskInput(taskInput));
  const original = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")!;
  let result:
    | Awaited<ReturnType<typeof parseRuntimeAgentRunInvocationHostedChatRequestFromRequest>>
    | undefined;
  try {
    Object.defineProperty(RegExp.prototype, "test", {
      configurable: true,
      value: function (this: RegExp, value: string) {
        if (this.source === "^[a-zA-Z0-9_-]{1,128}$") throw new Error("tenant regexp test");
        return Reflect.apply(original.value, this, [value]);
      },
    });
    result = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(request, {
      authenticate: async () => ({ userId, authToken: "synthetic-user-token" }),
      verifyProjectAccess: async () => ({ success: true as const }),
      runtimeSource: source,
      verifyRunEventAppendToken: async () => ({
        verified: true,
        rootRunId: "run_root",
        taskInputRootRunId: "run_root",
        taskInputSha256: digest,
      }),
    });
    Object.defineProperty(RegExp.prototype, "test", {
      configurable: true,
      value: function (this: RegExp, value: string) {
        return this.source === "^[a-zA-Z0-9_-]{1,128}$"
          ? true
          : Reflect.apply(original.value, this, [value]);
      },
    });
    invalidResult = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
      invalidRequest,
      {
        authenticate: async () => ({ userId, authToken: "synthetic-user-token" }),
        verifyProjectAccess: async () => ({ success: true as const }),
        runtimeSource: source,
        verifyRunEventAppendToken: async () => ({ verified: true, rootRunId: "bad/root" }),
      },
    );
  } finally {
    Object.defineProperty(RegExp.prototype, "test", original);
  }
  assertEquals(invalidResult instanceof Response && invalidResult.status, 403);
  assertEquals(result instanceof Response, false);
  assertEquals(
    result && !(result instanceof Response) && result.serverResolvedRootRunId,
    "run_root",
  );
  assertEquals(
    result && !(result instanceof Response) && result.serverResolvedTaskInput,
    taskInput,
  );
});

it("keeps response bytes and lifecycle private from tenant stream and response hooks", async () => {
  const originalResponse = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("later-tenant-secret"));
        controller.close();
      },
    }),
    {
      status: 202,
      statusText: "Accepted",
      headers: [["x-evidence", "private"], ["set-cookie", "a=1"], ["set-cookie", "b=2"]],
    },
  );
  const patches: {
    target: object;
    key: PropertyKey;
    descriptor: PropertyDescriptor | undefined;
  }[] = [];
  const hooks: string[] = [];
  const poison = (target: object, key: PropertyKey, getter = false) => {
    patches.push({ target, key, descriptor: Object.getOwnPropertyDescriptor(target, key) });
    const hook = () => {
      hooks.push(String(key));
      throw new Error("tenant response hook");
    };
    Object.defineProperty(target, key, {
      configurable: true,
      ...(getter ? { get: hook } : { value: hook }),
    });
  };
  let response: Response | undefined;
  let error: unknown;
  try {
    poison(Response.prototype, "body", true);
    poison(Response.prototype, "status", true);
    poison(Response.prototype, "statusText", true);
    poison(Response.prototype, "headers", true);
    poison(ReadableStream.prototype, "getReader");
    poison(ReadableStreamDefaultReader.prototype, "read");
    poison(ReadableStreamDefaultReader.prototype, "cancel");
    poison(ReadableStreamDefaultController.prototype, "enqueue");
    poison(ReadableStreamDefaultController.prototype, "close");
    poison(ReadableStreamDefaultController.prototype, "error");
    poison(Headers.prototype, Symbol.iterator);
    poison(Object.prototype, "start", true);
    response = await withHostedChildTaskInputResolver(
      async () => undefined,
      async () => originalResponse,
    );
  } catch (caught) {
    error = caught;
  } finally {
    for (let index = patches.length - 1; index >= 0; index--) {
      const patch = patches[index]!;
      if (patch.descriptor) Object.defineProperty(patch.target, patch.key, patch.descriptor);
      else Reflect.deleteProperty(patch.target, patch.key);
    }
  }
  assertEquals(error, undefined);
  assertEquals(hooks, []);
  assertEquals(response?.status, 202);
  assertEquals(response?.statusText, "Accepted");
  assertEquals(response?.headers.get("x-evidence"), "private");
  assertEquals(response?.headers.getSetCookie(), ["a=1", "b=2"]);
  assertEquals(await response?.text(), "later-tenant-secret");
});

it("cancels the actual response reader despite a replaced native cancel method", async () => {
  let reason: unknown;
  const response = await withHostedChildTaskInputResolver(
    async () => undefined,
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel(value) {
            reason = value;
          },
        }),
      ),
  );
  const body = response.body!;
  const descriptor = Object.getOwnPropertyDescriptor(
    ReadableStreamDefaultReader.prototype,
    "cancel",
  )!;
  let intercepted = false;
  try {
    Object.defineProperty(ReadableStreamDefaultReader.prototype, "cancel", {
      configurable: true,
      value: () => {
        intercepted = true;
        return Promise.resolve();
      },
    });
    await body.cancel("stop");
  } finally {
    Object.defineProperty(ReadableStreamDefaultReader.prototype, "cancel", descriptor);
  }
  assertEquals(intercepted, false);
  assertEquals(reason, "stop");
});

function evidenceOwner() {
  return {
    projectId: "project-1",
    authToken: "synthetic-parent-token",
    durableRootRun: { runId: "parent" },
  } as ParsedHostedChatRequest;
}
const evidenceCanonical = "11111111-1111-4111-8111-111111111111";
function evidenceToken(claims: object) {
  return `header.${btoa(JSON.stringify(claims))}.signature`;
}
function registerEvidenceOwner(owner: ParsedHostedChatRequest, verified: boolean) {
  const terminal = evidenceToken({
    tokenUse: "run_event_writer",
    writerPurpose: "current_run_terminal",
    runId: "parent",
    canonicalRunId: evidenceCanonical,
    dispatchNonce: "dispatch",
  });
  const writer = evidenceToken({
    projectId: "project-1",
    runId: "parent",
    workerGeneration: {
      projectId: "project-1",
      runId: "parent",
      canonicalRunId: evidenceCanonical,
    },
  });
  registerHostedTerminalCredential(owner, terminal, writer, (input) => {
    assertEquals(input, {
      token: writer,
      projectId: "project-1",
      runId: "parent",
      ...(owner.agentId ? { agentId: owner.agentId } : {}),
    });
    return Promise.resolve({ verified });
  });
}

it("consumes both evidence responses without exposing authenticated bytes to replaced hooks", async () => {
  const owner = { ...evidenceOwner(), agentId: "parent-agent" };
  registerEvidenceOwner(owner, true);
  const version = "77777777-7777-4777-8777-777777777777";
  const responses = [
    Response.json({ data: [], page_info: { next: null } }),
    Response.json({ path: "note", id: version, content: "private bytes" }),
  ];
  let index = 0;
  const evidence = hostedAcceptedChildEvidence(owner, "project-1", undefined, {
    apiUrl: "https://api.example",
    fetch: () => Promise.resolve(responses[index++]!),
  });
  const ok = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!;
  const body = Object.getOwnPropertyDescriptor(Response.prototype, "body")!;
  const status = Object.getOwnPropertyDescriptor(Response.prototype, "status")!;
  const read = ReadableStreamDefaultReader.prototype.read;
  let intercepted = 0;
  try {
    Object.defineProperty(Response.prototype, "ok", {
      configurable: true,
      get() {
        intercepted++;
        return Reflect.apply(ok.get!, this, []);
      },
    });
    for (const [key, descriptor] of [["body", body], ["status", status]] as const) {
      Object.defineProperty(Response.prototype, key, {
        configurable: true,
        get() {
          intercepted++;
          return Reflect.apply(descriptor.get!, this, []);
        },
      });
    }
    ReadableStreamDefaultReader.prototype.read = function () {
      intercepted++;
      return Reflect.apply(read, this, []);
    };
    await evidence.readParentToolResults();
    assertEquals(await evidence.readCommittedVersion("note", version), {
      path: "note",
      versionId: version,
      content: "private bytes",
    });
  } finally {
    Object.defineProperty(Response.prototype, "ok", ok);
    Object.defineProperty(Response.prototype, "body", body);
    Object.defineProperty(Response.prototype, "status", status);
    ReadableStreamDefaultReader.prototype.read = read;
  }
  assertEquals(intercepted, 0);
});

it("rejects unverified parent evidence authority before sending the broad bearer", async () => {
  const owner = evidenceOwner();
  registerEvidenceOwner(owner, false);
  let calls = 0;
  const evidence = hostedAcceptedChildEvidence(owner, "project-1", undefined, {
    apiUrl: "https://api.example",
    fetch: () => {
      calls++;
      return Promise.resolve(Response.json({ data: [], page_info: { next: null } }));
    },
  });
  await assertRejects(() => evidence.readParentToolResults(), Error, "verified parent");
  assertEquals(calls, 0);
});

it("uses the verified writer parent when the terminal routing payload names another run", async () => {
  const owner = evidenceOwner();
  const writer = evidenceToken({
    projectId: "project-1",
    runId: "parent",
    workerGeneration: {
      projectId: "project-1",
      runId: "parent",
      canonicalRunId: evidenceCanonical,
    },
  });
  const terminal = evidenceToken({
    tokenUse: "run_event_writer",
    writerPurpose: "current_run_terminal",
    runId: "parent",
    canonicalRunId: "22222222-2222-4222-8222-222222222222",
    dispatchNonce: "dispatch",
  });
  registerHostedTerminalCredential(owner, terminal, writer, (input) => {
    assertEquals(input.token, writer);
    return Promise.resolve(true);
  });
  let url: string | undefined;
  const evidence = hostedAcceptedChildEvidence(owner, "project-1", undefined, {
    apiUrl: "https://api.example",
    fetch: (input) => {
      url = String(input);
      return Promise.resolve(Response.json({ data: [], page_info: { next: null } }));
    },
  });
  await evidence.readParentToolResults();
  assertEquals(
    url,
    `https://api.example/runs/${evidenceCanonical}/events?event_type=TOOL_CALL_RESULT&limit=100&sort_order=desc&include_descendants=false`,
  );
});

for (
  const claims of [
    { projectId: "foreign", runId: "parent" },
    { projectId: "project-1", runId: "foreign" },
    { projectId: "project-1", runId: "parent" },
    {
      projectId: "project-1",
      runId: "parent",
      workerGeneration: {
        projectId: "foreign",
        runId: "parent",
        canonicalRunId: evidenceCanonical,
      },
    },
    {
      projectId: "project-1",
      runId: "parent",
      workerGeneration: {
        projectId: "project-1",
        runId: "foreign",
        canonicalRunId: evidenceCanonical,
      },
    },
  ]
) {
  it(`rejects absent or conflicting signed parent identity ${JSON.stringify(claims)}`, async () => {
    const owner = evidenceOwner();
    registerHostedTerminalCredential(
      owner,
      "unused-routing-hint",
      evidenceToken(claims),
      () => Promise.resolve(true),
    );
    let calls = 0;
    const evidence = hostedAcceptedChildEvidence(owner, "project-1", undefined, {
      apiUrl: "https://api.example",
      fetch: () => {
        calls++;
        throw new Error("Unexpected read");
      },
    });
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "workerGeneration");
    try {
      Object.defineProperty(Object.prototype, "workerGeneration", {
        configurable: true,
        value: { projectId: "project-1", runId: "parent", canonicalRunId: evidenceCanonical },
      });
      await assertRejects(() => evidence.readParentToolResults(), Error, "verified parent");
      await assertRejects(
        () => evidence.readCommittedVersion("note", evidenceCanonical),
        Error,
        "verified parent",
      );
    } finally {
      if (descriptor) Object.defineProperty(Object.prototype, "workerGeneration", descriptor);
      else Reflect.deleteProperty(Object.prototype, "workerGeneration");
    }
    assertEquals(calls, 0);
  });
}

it("reads a verified project attempt without terminal hints", async () => {
  const owner = {
    ...evidenceOwner(),
    durableRootRun: { runId: evidenceCanonical },
  } as ParsedHostedChatRequest;
  const writer = evidenceToken({
    projectId: "project-1",
    runId: evidenceCanonical,
    projectExecutionAttempt: { canonicalRunId: evidenceCanonical },
  });
  registerHostedTerminalCredential(
    owner,
    "unused-routing-hint",
    writer,
    () => Promise.resolve(true),
  );
  const evidence = hostedAcceptedChildEvidence(owner, "project-1", undefined, {
    apiUrl: "https://api.example",
    fetch: (input) => {
      assertEquals(
        String(input),
        `https://api.example/runs/${evidenceCanonical}/events?event_type=TOOL_CALL_RESULT&limit=100&sort_order=desc&include_descendants=false`,
      );
      return Promise.resolve(Response.json({ data: [], page_info: { next: null } }));
    },
  });
  assertEquals(await evidence.readParentToolResults(), []);
});

for (const hook of ["ok", "status", "body", "getReader"] as const) {
  it(`consumes accepted receipts without mutable ${hook} hooks`, async () => {
    const parentRunId = "parent-routing-id";
    const canonicalRunId = "11111111-1111-4111-8111-111111111111";
    const event: HostedAcceptedTaskInputEvent = {
      type: "AGENT_RUN_TASK_INPUT_ACCEPTED",
      version: 1,
      targetAgentId: "child-agent",
      sourceEventIds: [1],
      artifactVersions: [{
        path: "intake.json",
        version_id: canonicalRunId,
        sha256: "a".repeat(64),
        size_bytes: 12,
      }],
      payload: { intakeId: "intake-1" },
    };
    const result = () =>
      Response.json({
        run_id: canonicalRunId,
        appended_count: 1,
        latest_event_id: 2,
      });
    const response = hook === "status" ? new Response(null, { status: 403 }) : result();
    const target = hook === "getReader" ? ReadableStream.prototype : Response.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(target, hook)!;
    let intercepted = 0;
    const poison = () => {
      intercepted++;
      throw new Error("Tenant hook invoked");
    };
    const writer = createHostedRunEventWriterCapability({
      apiUrl: "https://api.example/v1/",
      runId: parentRunId,
      canonicalRunId,
      runEventAppendToken: "synthetic-parent-token",
      fetch: () => {
        Object.defineProperty(
          target,
          hook,
          hook === "getReader" ? { ...descriptor, value: poison } : { ...descriptor, get: poison },
        );
        return Promise.resolve(response);
      },
    });
    try {
      const operation = () =>
        persistHostedAcceptedTaskInput({
          capability: writer,
          parentRunId,
          toolCallId: "call-1",
          event,
        });
      if (hook === "status") await assertRejects(operation, Error, "(403)");
      else await operation();
    } finally {
      Object.defineProperty(target, hook, descriptor);
    }
    assertEquals(intercepted, 0);
  });
}

for (const replacement of ["throw", "reject", "accept"] as const) {
  it(`validates accepted receipt integers without a tenant ${replacement} hook`, async () => {
    const canonicalRunId = "11111111-1111-4111-8111-111111111111";
    const original = Number.isSafeInteger;
    let calls = 0;
    const writer = createHostedRunEventWriterCapability({
      apiUrl: "https://api.example",
      runId: "parent",
      canonicalRunId,
      runEventAppendToken: "synthetic-writer",
      fetch: () => {
        Number.isSafeInteger = () => {
          calls++;
          if (replacement === "throw") throw new Error("Tenant number hook");
          return replacement === "accept";
        };
        return Promise.resolve(Response.json({
          run_id: canonicalRunId,
          appended_count: 1,
          latest_event_id: replacement === "accept" ? 1.5 : 2,
        }));
      },
    });
    try {
      const operation = () =>
        persistHostedAcceptedTaskInput({
          capability: writer,
          parentRunId: "parent",
          toolCallId: "call-1",
          event: {
            type: "AGENT_RUN_TASK_INPUT_ACCEPTED",
            version: 1,
            targetAgentId: "child",
            sourceEventIds: [1],
            artifactVersions: [{
              path: "input.json",
              version_id: canonicalRunId,
              sha256: "a".repeat(64),
              size_bytes: 12,
            }],
            payload: { intakeId: "synthetic" },
          },
        });
      if (replacement === "accept") {
        await assertRejects(operation, Error, "Invalid accepted task input persistence receipt");
      } else await operation();
    } finally {
      Number.isSafeInteger = original;
    }
    assertEquals(calls, 0);
  });
}
