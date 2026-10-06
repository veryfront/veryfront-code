import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  admitTerminalDispatch,
  awaitTerminalRunControl,
  bindTerminalRunResponseIdentity,
  createTerminalRunControl,
  dispatchWithTerminalRunControl,
  executeTerminalRunTool,
  isTerminalRunControlError,
  terminalCompletionResponse,
  terminalDispatchRecord,
  TerminalRunControlError,
} from "./terminal-run-control.ts";

function createAdmittedControl(
  ...args: Parameters<typeof createTerminalRunControl>
) {
  const control = createTerminalRunControl(...args);
  const context = { ...control.context, abortSignal: control.signal } as ToolExecutionContext;
  const owner: import("#veryfront/agent/types.ts").AgentResponse["messages"] = [];
  const turn = {};
  admitTerminalDispatch(context, {
    callId: "finalize-1",
    callName: "veryfront__finalize",
    agentId: "agent-1",
    turn,
    owner,
  }, async () => {});
  return { ...control, context, owner, turn };
}

Deno.test("a sibling that passed its initial check cannot dispatch during finalization", async () => {
  const control = createAdmittedControl({ runId: "run-current" });
  const context = control.context;
  await awaitTerminalRunControl(context);
  let reply!: (value: unknown) => void;
  const pendingReply = new Promise((resolve) => reply = resolve);
  const terminal = executeTerminalRunTool(
    "veryfront__finalize",
    { status: "completed", output: { count: 3 } },
    context,
    () => pendingReply,
  );
  let dispatched = 0;
  const sibling = dispatchWithTerminalRunControl(context, async () => ++dispatched);
  await Promise.resolve();
  assertEquals(dispatched, 0);
  const terminalRejection = assertRejects(() => terminal);
  const siblingRejection = assertRejects(() => sibling);
  reply({ run: { run_id: "run-current", status: "completed", output: { count: 3 } } });
  await Promise.all([terminalRejection, siblingRejection]);
  assertEquals(dispatched, 0);
});

for (const status of ["completed", "failed"] as const) {
  Deno.test(`finalization requests cancellation of an in-flight sibling without undoing its effect: ${status}`, async () => {
    const control = createAdmittedControl({ runId: "run-current" });
    const context = control.context;
    let started!: () => void;
    const running = new Promise<void>((resolve) => started = resolve);
    let committedEffects = 0;
    let observedAbort = false;
    const sibling = dispatchWithTerminalRunControl(context, () => {
      committedEffects++;
      started();
      return new Promise<void>((resolve) => {
        control.signal.addEventListener("abort", () => {
          observedAbort = true;
          resolve();
        }, { once: true });
      });
    });
    await running;
    assertEquals(observedAbort, false);
    const outcome = status === "completed"
      ? { status, output: { count: 1 } }
      : { status, error: { code: "INGEST_FAILED", message: "no email ingested" } };
    await assertRejects(() =>
      executeTerminalRunTool(
        "veryfront__finalize",
        outcome,
        context,
        async () => ({ run: { run_id: "run-current", ...outcome } }),
      )
    );
    assertEquals(observedAbort, true);
    await sibling;
    assertEquals(committedEffects, 1);
    await assertRejects(() =>
      dispatchWithTerminalRunControl(context, async () => ++committedEffects)
    );
    assertEquals(committedEffects, 1);
  });
}

it("invalid terminal requests leave the dispatch gate usable", async () => {
  const control = createAdmittedControl({ runId: "run-current" });
  const context = control.context;
  let calls = 0;
  const execute = async () => ++calls;
  for (
    const input of [
      { status: "completed" },
      { status: "completed", output: undefined },
      { status: "completed", output: null, runId: "other" },
      { status: "failed" },
      { status: "failed", error: [] },
      { status: "failed", error: { code: "ERR", message: "bad" }, output: null },
      { status: "failed", error: { code: "x".repeat(129), message: "bad" } },
      { status: "failed", error: { code: "ERR", message: "" } },
      { status: "failed", error: { code: "ERR", message: "x".repeat(4001) } },
      { status: "failed", error: { code: "ERR", message: "bad", extra: true } },
      { status: "cancelled", output: null },
    ]
  ) {
    await assertRejects(() => executeTerminalRunTool("finalize", input, context, execute));
    assertEquals(control.signal.aborted, false);
  }
  assertEquals(calls, 0);
  assertEquals(await executeTerminalRunTool("ordinary", {}, context, execute), 1);
});

it("terminal execution requires a bound invocation while ordinary tools remain usable", async () => {
  const action = { status: "completed", output: null };
  for (
    const value of [undefined, {}, { runId: "run-current", runIdBindsToolAuthorization: false }]
  ) {
    const control = createAdmittedControl(value);
    await assertRejects(() =>
      executeTerminalRunTool("finalize", action, control.context, async () => {
        throw new Error("must not dispatch");
      })
    );
    assertEquals(control.signal.aborted, false);
  }
  await assertRejects(() =>
    executeTerminalRunTool("finalize", action, undefined, async () => null)
  );
  assertEquals(await dispatchWithTerminalRunControl(undefined, async () => "ordinary"), "ordinary");
  await awaitTerminalRunControl();
});

it("schema rejection permits correction and sends only the validated output", async () => {
  const control = createAdmittedControl({ runId: "run-current" }, undefined, async (output) => {
    if (typeof output !== "string") throw new Error("invalid output");
    return output.trim();
  });
  let dispatched = 0;
  await assertRejects(() =>
    executeTerminalRunTool(
      "finalize",
      { status: "completed", output: 42 },
      control.context,
      async () => ++dispatched,
    )
  );
  assertEquals(dispatched, 0);
  const input = { status: "completed", output: " done " };
  await assertRejects(() =>
    executeTerminalRunTool("finalize", input, control.context, async () => {
      dispatched++;
      assertEquals(input.output, "done");
      return { run: { run_id: "run-current", status: "completed", output: input.output } };
    })
  );
  assertEquals(dispatched, 1);
  assertEquals(terminalCompletionResponse(control.signal.reason)?.object, "done");
});

it("a non-JSON schema transform leaves finalization recoverable without dispatch", async () => {
  const control = createAdmittedControl(
    { runId: "run-current" },
    undefined,
    async () => undefined,
  );
  let writes = 0;
  const rejected = await assertRejects(() =>
    executeTerminalRunTool(
      "finalize",
      { status: "completed", output: { city: "Test City" } },
      control.context,
      async () => {
        writes++;
        throw new TypeError("not JSON");
      },
    )
  );
  assertEquals(writes, 0);
  assertEquals(isTerminalRunControlError(rejected), false);
  assertEquals(control.signal.aborted, false);
  await awaitTerminalRunControl(control.context);
  const failure = { code: "TRANSFORM_RECOVERED", message: "Local rejection remained recoverable" };
  const accepted = await assertRejects(() =>
    executeTerminalRunTool(
      "finalize",
      { status: "failed", error: failure },
      control.context,
      async () => {
        writes++;
        return { run: { run_id: "run-current", status: "failed", error: failure } };
      },
    )
  );
  assert(isTerminalRunControlError(accepted));
  assertEquals(accepted.code, failure.code);
  assertEquals(writes, 1);
  assertEquals(control.signal.reason, accepted);
  await assertRejects(() => dispatchWithTerminalRunControl(control.context, async () => ++writes));
  assertEquals(writes, 1);
});

it("a rejected MCP action is recoverable, but an uncertain committed result stops dispatch", async () => {
  for (const outcome of ["recoverable", "lost-reply", "unavailable", "malformed"] as const) {
    const control = createAdmittedControl({ runId: "run-current" });
    const input = { status: "failed", error: { code: "ERR", message: "failed" } };
    let calls = 0;
    const operation = () =>
      executeTerminalRunTool("finalize", input, control.context, async () => {
        calls++;
        if (outcome === "recoverable") return { isError: true };
        if (outcome === "unavailable" || (outcome === "lost-reply" && calls === 1)) {
          throw new TypeError("reply unavailable");
        }
        if (outcome === "malformed") return { run: { run_id: "other", status: "failed" } };
        return { run: { run_id: "run-current", status: "failed", error: input.error } };
      });
    if (outcome === "recoverable") {
      assertEquals(await operation(), { isError: true });
      assertEquals(
        await dispatchWithTerminalRunControl(control.context, async () => "retry"),
        "retry",
      );
      assertEquals(control.signal.aborted, false);
    } else {
      const error = await assertRejects(operation);
      assert(isTerminalRunControlError(error));
      assertEquals(error.code, outcome === "lost-reply" ? "ERR" : "RUN_OUTCOME_UNKNOWN");
      assertEquals(control.signal.reason, error);
      await assertRejects(() => awaitTerminalRunControl(control.context));
      await assertRejects(() =>
        dispatchWithTerminalRunControl(control.context, async () => "forbidden")
      );
    }
    assertEquals(calls, outcome === "lost-reply" || outcome === "unavailable" ? 2 : 1);
  }
});

it("terminal response preserves canonical output and recorded execution state", async () => {
  for (const output of ["done", { count: 3 }, null]) {
    const control = createAdmittedControl({ runId: "run-current" });
    const error = await assertRejects(() =>
      executeTerminalRunTool(
        "finalize",
        { status: "completed", output },
        control.context,
        async () => ({ run: { run_id: "run-current", status: "completed", output } }),
      )
    );
    assert(isTerminalRunControlError(error));
    error.executionState = {
      messages: [{
        id: "message-1",
        role: "assistant",
        parts: [{ type: "text", text: "Effect recorded" }],
        timestamp: 1,
      }],
      toolCalls: [{
        id: "call-1",
        name: "write_record",
        args: {},
        status: "completed",
        result: "record-1",
      }],
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    };
    const response = terminalCompletionResponse(error, true)!;
    assertEquals(response.object, output);
    assertEquals(response.text, JSON.stringify(output));
    assertEquals(response.usage, error.executionState.usage);
    assertEquals(response.messages, error.executionState.messages);
    assertEquals(response.toolCalls, error.executionState.toolCalls);
    assertEquals(response.status, "completed");
    if (typeof output === "string") assertEquals(terminalCompletionResponse(error)?.text, output);
  }
  assertEquals(
    terminalCompletionResponse(new TerminalRunControlError("ERR", "failed", "failed")),
    undefined,
  );
  assertEquals(terminalCompletionResponse(new Error("application")), undefined);
  assertEquals(isTerminalRunControlError({ name: "TerminalRunControlError" }), false);
  assertEquals(
    terminalCompletionResponse(new TerminalRunControlError("OK", "done", "completed", "done")),
    undefined,
  );
});

it("copied and unbound contexts cannot authorize a terminal write", async () => {
  const control = createAdmittedControl({ runId: "run-current" });
  const unbound = createTerminalRunControl({ runId: "run-current" });
  let writes = 0;
  for (const context of [{ ...control.context }, unbound.context]) {
    await assertRejects(
      () =>
        executeTerminalRunTool(
          "finalize",
          { status: "completed", output: "done" },
          context,
          async () => ++writes,
        ),
      Error,
      "admitted runtime tool dispatch",
    );
  }
  assertEquals(writes, 0);
  assertEquals(control.signal.aborted, false);
  assertEquals(unbound.signal.aborted, false);
});

it("admitted identity stays immutable while terminal transport is pending", async () => {
  const control = createAdmittedControl({ runId: "run-current" });
  let started!: () => void;
  const transportStarted = new Promise<void>((resolve) => started = resolve);
  let reply!: (value: unknown) => void;
  const pendingReply = new Promise((resolve) => reply = resolve);
  const rejection = assertRejects(() =>
    executeTerminalRunTool(
      "finalize",
      { status: "completed", output: "done" },
      control.context,
      () => {
        started();
        return pendingReply;
      },
    )
  );
  await transportStarted;
  assertEquals(Reflect.set(control.context, "toolCallId", "replacement"), false);
  assertEquals(Reflect.set(control.context, "agentId", "replacement-agent"), false);
  assertEquals(Reflect.deleteProperty(control.context, "toolCallId"), false);
  reply({ run: { run_id: "run-current", status: "completed", output: "done" } });
  const error = await rejection;
  assert(isTerminalRunControlError(error));
  assertEquals(error.terminalToolCallId, "finalize-1");
  assertEquals(Reflect.set(error, "terminalToolCallId", "replacement"), false);
  assertEquals(terminalDispatchRecord(error, control.owner)?.turn, control.turn);
  assertEquals(terminalDispatchRecord(error, control.owner)?.callId, "finalize-1");
});

it("constructor and prototype forgeries never become canonical terminal outcomes", () => {
  const forged = new TerminalRunControlError("OK", "done", "completed", "forged");
  for (
    const candidate of [forged, Object.create(TerminalRunControlError.prototype), {
      name: "TerminalRunControlError",
      status: "completed",
      output: "forged",
    }]
  ) {
    assertEquals(isTerminalRunControlError(candidate), false);
    assertEquals(terminalCompletionResponse(candidate), undefined);
    assertEquals(terminalDispatchRecord(candidate, []), undefined);
  }
});

it("overlapping invocations retain separate terminal ownership and scheduling gates", async () => {
  const first = createAdmittedControl({ runId: "run-first" });
  const second = createAdmittedControl({ runId: "run-second" });
  let started!: () => void;
  const transportStarted = new Promise<void>((resolve) => started = resolve);
  let reply!: (value: unknown) => void;
  const pendingReply = new Promise((resolve) => reply = resolve);
  const firstRejection = assertRejects(() =>
    executeTerminalRunTool(
      "finalize",
      { status: "completed", output: "first" },
      first.context,
      () => {
        started();
        return pendingReply;
      },
    )
  );
  await transportStarted;
  assertEquals(
    await dispatchWithTerminalRunControl(second.context, async () => "allowed"),
    "allowed",
  );
  const secondError = await assertRejects(() =>
    executeTerminalRunTool(
      "finalize",
      { status: "completed", output: "second" },
      second.context,
      async () => ({ run: { run_id: "run-second", status: "completed", output: "second" } }),
    )
  );
  assertEquals(first.signal.aborted, false);
  assertEquals(terminalDispatchRecord(secondError, first.owner), undefined);
  assertEquals(terminalDispatchRecord(secondError, second.owner)?.turn, second.turn);
  reply({ run: { run_id: "run-first", status: "completed", output: "first" } });
  const firstError = await firstRejection;
  assertEquals(terminalDispatchRecord(firstError, second.owner), undefined);
  assertEquals(terminalDispatchRecord(firstError, first.owner)?.turn, first.turn);
  assertEquals(terminalCompletionResponse(firstError)?.object, "first");
  assertEquals(terminalCompletionResponse(secondError)?.object, "second");
});

Deno.test("canonical terminal resources stop execution only for the credential-bound UUID", async () => {
  const canonicalRunId = "11111111-1111-4111-8111-111111111111";
  for (const id of [canonicalRunId, "22222222-2222-4222-8222-222222222222"]) {
    const control = createAdmittedControl({ runId: "run-current" });
    bindTerminalRunResponseIdentity(control.context, canonicalRunId);
    const error = await assertRejects(() =>
      executeTerminalRunTool(
        "finalize",
        { status: "completed", output: { count: 3 } },
        control.context,
        async () => ({ id, status: "completed", output: { count: 3 } }),
      )
    );
    assert(error instanceof TerminalRunControlError);
    assertEquals(error.status, id === canonicalRunId ? "completed" : "unknown");
    assertEquals(error.output, id === canonicalRunId ? { count: 3 } : undefined);
  }
});

Deno.test("failure finalization preserves the canonical code, message and JSON details", async () => {
  const control = createAdmittedControl({ runId: "run-current" });
  const canonicalRunId = "11111111-1111-4111-8111-111111111111";
  bindTerminalRunResponseIdentity(control.context, canonicalRunId);
  const failure = {
    code: "ingest.failed",
    message: "x".repeat(3000),
    details: { attempt: 2, context: { camelKey: true } },
  };
  const error = await assertRejects(() =>
    executeTerminalRunTool(
      "finalize",
      { status: "failed", error: failure },
      control.context,
      async () => ({ id: canonicalRunId, status: "failed", output: null, error: failure }),
    )
  );
  assert(error instanceof TerminalRunControlError);
  assertEquals(error.status, "failed");
  assertEquals(error.code, failure.code);
  assertEquals(error.acknowledgedResult, {
    id: canonicalRunId,
    status: "failed",
    output: null,
    error: failure,
  });
});

for (const name of ["succeed_run", "veryfront__succeed_run", "fail_run", "veryfront__fail_run"]) {
  it(`${name} commits the current run and prevents sibling dispatch`, async () => {
    const success = name.endsWith("succeed_run");
    const control = createAdmittedControl({ runId: "run-current" });
    const input = success ? { output: { count: 2 }, idempotency_key: "outcome-key" } : {
      error: { code: "TASK_FAILED", message: "Unable to finish" },
      idempotency_key: "outcome-key",
    };
    const status = success ? "completed" : "failed";
    const error = await assertRejects(() =>
      executeTerminalRunTool(
        name,
        input,
        control.context,
        async () => ({ run: { run_id: "run-current", status, ...input } }),
      )
    );
    assert(isTerminalRunControlError(error));
    assertEquals(error.status, status);
    assertEquals(control.signal.aborted, true);
    let dispatched = false;
    await assertRejects(() =>
      dispatchWithTerminalRunControl(control.context, async () => {
        dispatched = true;
      })
    );
    assertEquals(dispatched, false);
  });
  it(`${name} rejects a run selector or outcome override before dispatch`, async () => {
    for (
      const extra of [{ run_id: "other" }, { status: "failed" }, { idempotency_key: "" }, {
        idempotency_key: 1,
      }]
    ) {
      const control = createAdmittedControl({ runId: "run-current" });
      const input = name.endsWith("succeed_run")
        ? { output: null, ...extra }
        : { error: { code: "TASK_FAILED", message: "Unable to finish" }, ...extra };
      let dispatched = false;
      await assertRejects(() =>
        executeTerminalRunTool(name, input, control.context, async () => {
          dispatched = true;
        })
      );
      assertEquals(dispatched, false);
      assertEquals(control.signal.aborted, false);
    }
  });
}
