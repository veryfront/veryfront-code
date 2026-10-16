import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  materializePayloadSemanticCase,
  validatePayloadSemantics,
} from "./resources/payload-semantics.mjs";

const payload = (name: string, fields: Record<string, unknown>) => ({
  type: `com.veryfront.run.${name}`,
  ...fields,
});
const check = (name: string, fields: Record<string, unknown>) =>
  validatePayloadSemantics(payload(name, fields));

describe("canonical payload semantic boundaries", () => {
  it("rejects impossible compaction budgets while accepting exact limits", () => {
    assertEquals(
      check("context.compacted", {
        tokenBudget: 100,
        reserveTokens: 20,
        tokensBefore: 90,
        tokensAfter: 80,
      }),
      [],
    );
    assertEquals(
      check("context.compacted", {
        tokenBudget: 100,
        reserveTokens: 100,
        tokensBefore: 80,
        tokensAfter: 101,
      }).length,
      3,
    );
  });
  it("requires ordered tool names and aligned replay positions and message counts", () => {
    assertEquals(
      check("tool.exposure.checkpointed", { version: 1, loadedToolNames: ["a", "z"] }),
      [],
    );
    assertEquals(
      check("tool.exposure.checkpointed", { version: 1, loadedToolNames: ["z", "a"] }).length,
      1,
    );
    assertEquals(
      check("provider.replay.checkpointed", {
        providerBlocks: [{}, {}],
        providerBlockPositions: [0, 1],
        totalPartCount: 2,
        providerMessageBlockCounts: [1, 1],
      }),
      [],
    );
    assertEquals(
      check("provider.replay.checkpointed", {
        providerBlocks: [{}, {}],
        providerBlockPositions: [1, 1, 2],
        totalPartCount: 1,
        providerMessageBlockCounts: [1],
      }).length,
      7,
    );
  });
  it("bounds UTF-8 JSON bytes, cyclic schemas and duplicate delegated call identities", () => {
    assertEquals(
      check("provider.replay.boundary.recorded", { invokeAgentToolCalls: [{ toolCallId: "a" }] }),
      [],
    );
    assertEquals(
      check("provider.replay.boundary.recorded", {
        text: "x".repeat(2 * 1024 * 1024),
        invokeAgentToolCalls: [{ toolCallId: "a" }, { toolCallId: "a" }],
      }).length,
      2,
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assertEquals(
      check("requested", { tools: [{ inputSchema: { toJSON: () => undefined } }] }).length,
      1,
    );
    assertEquals(
      check("requested", { tools: [{ parameters: {}, inputSchema: {}, outputSchema: {} }] }),
      [],
    );
    assertEquals(
      check("enqueued", {
        tools: [null, {
          parameters: "é".repeat(8192),
          inputSchema: cyclic,
          outputSchema: "x".repeat(16384),
        }],
      }).length,
      3,
    );
  });
  it("requires managed source agreement and unique integration authorization bindings", () => {
    const source = {
      sourceBinding: { projectId: "p", environmentId: "e", releaseId: "r" },
      sourceProject: {
        projectId: "p",
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: "e",
        executionEnvironmentId: "e",
      },
      agentSource: { type: "environment", releaseId: "r" },
    };
    assertEquals(check("requested", { managedRuntimeSource: source }), []);
    assertEquals(
      check("requested", {
        managedRuntimeSource: {
          ...source,
          sourceProject: {
            projectId: "other",
            runtimeTargetKind: "main_branch",
            runtimeTargetEnvironmentId: "other",
            executionEnvironmentId: "other",
          },
          agentSource: { type: "release", releaseId: "other" },
        },
        integrationConnectionBindings: [null, {}, { integration: "a" }, { integration: "a" }],
      }).length,
      8,
    );
    for (
      const sourceProject of [
        { runtimeTargetKind: "preview_branch" },
        { runtimeTargetKind: "environment" },
      ]
    ) {
      assertEquals(check("requested", { managedRuntimeSource: { sourceProject } }).length, 1);
    }
    assertEquals(check("requested", { managedRuntimeSource: null }), []);
  });
  it("distinguishes server restart retries from retries requiring a finite attempt", () => {
    assertEquals(check("runtime.retry.recorded", { kind: "server_restart" }), []);
    assertEquals(check("runtime.retry.recorded", { kind: "server_restart", attempt: 1 }).length, 1);
    for (const kind of ["pre_stream", "replay_conflict", "transport_recovery"]) {
      assertEquals(check("runtime.retry.recorded", { kind, attempt: 1 }), []);
      assertEquals(check("runtime.retry.recorded", { kind, attempt: Infinity }).length, 1);
      assertEquals(check("runtime.retry.recorded", { kind }).length, 1);
    }
  });
  it("follows only event wrappers while retaining opaque provider data", () => {
    const invalid = payload("runtime.retry.recorded", { kind: "pre_stream" });
    assertEquals(
      validatePayloadSemantics([
        null,
        { specversion: "1.0", data: invalid },
        { event_type: invalid.type, payload: invalid },
        { type: "custom", providerData: invalid },
      ]).length,
      2,
    );
  });
});

describe("canonical semantic case materialization", () => {
  const fixtures = [{
    id: "retry",
    data: { type: "com.veryfront.run.runtime.retry.recorded", kind: "pre_stream", attempt: 1 },
  }];
  it("detaches cases and expands compact mutations without changing the corpus", () => {
    const value = materializePayloadSemanticCase({
      baseExampleId: "retry",
      wrap: "cloud-event-data",
      mutations: [
        {
          op: "set",
          path: ["nested", "text"],
          value: { $repeat: { text: "x", count: 3, prefix: "a", suffix: "z" } },
        },
        { op: "set", path: ["list"], value: [{ item: 1 }] },
        { op: "delete", path: ["attempt"] },
      ],
    }, { examples: fixtures });
    assertEquals(value.data.nested.text, "axxxz");
    assertEquals(value.data.list, [{ item: 1 }]);
    assertEquals(validatePayloadSemantics(value).length, 1);
    assertEquals(fixtures[0]?.data.attempt, 1);
    assertEquals(
      validatePayloadSemantics(
        materializePayloadSemanticCase(
          { baseExampleId: "retry", wrap: "typed-row-payload" },
          fixtures,
        ),
      ),
      [],
    );
    assertEquals(
      validatePayloadSemantics(
        materializePayloadSemanticCase({ baseExampleId: "retry", wrap: "array" }, fixtures),
      ),
      [],
    );
  });
  it("rejects malformed mutations rather than producing misleading fixtures", () => {
    for (
      const testCase of [
        { baseExampleId: "missing" },
        { baseExampleId: "retry", mutations: [{ op: "set", path: [] }] },
        { baseExampleId: "retry", mutations: [{ op: "set", path: ["attempt", "x"] }] },
        { baseExampleId: "retry", mutations: [{ op: "unknown", path: ["x"] }] },
        {
          baseExampleId: "retry",
          mutations: [{ op: "set", path: ["x"], value: { $repeat: { text: "x", count: -1 } } }],
        },
      ]
    ) assertThrows(() => materializePayloadSemanticCase(testCase, fixtures));
  });
});
