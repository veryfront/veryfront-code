import {
  encodeHostedTaskInput,
  resolveHostedTaskInput,
} from "#veryfront/agent/hosted/task-input.ts";
import {
  type HostedAcceptedTaskInputEvent,
  snapshotHostedAcceptedTaskInputEvent,
} from "#veryfront/agent/hosted/accepted-task-input.ts";
import { assertThrows } from "#veryfront/testing/assert.ts";
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
  const token = `header.${
    btoa(JSON.stringify({
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
      runId: "parent",
      canonicalRunId: canonical,
      dispatchNonce: "dispatch",
    }))
  }.signature`;
  registerHostedTerminalCredential(owner, token);
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
  registerHostedTerminalCredential(
    owner,
    `header.${
      btoa(
        JSON.stringify({
          tokenUse: "run_event_writer",
          writerPurpose: "current_run_terminal",
          runId: "parent",
          canonicalRunId: canonical,
          dispatchNonce: "dispatch",
        }),
      )
    }.signature`,
  );
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
