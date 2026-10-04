import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { AgentResponse } from "#veryfront/agent/types.ts";
import { hasToolExecutionErrorMarker } from "#veryfront/tool/result.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";

const controlKey = Symbol("terminal-run-control");
const credentialOwnerKey = Symbol("terminal-credential-owner");
const terminalErrors = new WeakSet<object>();
const dispatches = new WeakMap<object, AdmittedDispatch>();
const outcomes = new WeakMap<object, AdmittedDispatch>();
const canonicalResponseIds = new WeakMap<object, string>();
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const freeze = Object.freeze;
const defineProperties = Object.defineProperties;

interface AdmittedDispatch {
  readonly invocation: object;
  readonly turn: object;
  readonly owner: AgentResponse["messages"];
  readonly callId: string;
  readonly callName: string;
  readonly prepare: () => Promise<void>;
}

/** Internal dispatch boundary; this association is never copied with application context. */
export function admitTerminalDispatch(
  context: ToolExecutionContext,
  identity: {
    callId: string;
    callName: string;
    agentId: string;
    turn: object;
    owner: AgentResponse["messages"];
  },
  prepare: () => Promise<void>,
): void {
  const invocation = (context as ControlContext)[controlKey];
  if (!invocation) return;
  const record = freeze({
    invocation,
    turn: identity.turn,
    owner: identity.owner,
    callId: identity.callId,
    callName: identity.callName,
    prepare,
  });
  defineProperties(context, {
    toolCallId: { value: record.callId, enumerable: true, writable: false, configurable: false },
    agentId: { value: identity.agentId, enumerable: true, writable: false, configurable: false },
  });
  apply(weakMapSet, dispatches, [context, record]);
}

/** Reconciliation accepts only the private outcome of this admitted invocation and turn. */
export function terminalDispatchRecord(
  error: unknown,
  owner: AgentResponse["messages"],
): AdmittedDispatch | undefined {
  if (!isTerminalRunControlError(error)) return undefined;
  const record = apply(weakMapGet, outcomes, [error]) as AdmittedDispatch | undefined;
  return record?.owner === owner ? record : undefined;
}

function terminalOutcome(
  record: AdmittedDispatch,
  code: string,
  message: string,
  status: string,
  output?: unknown,
  acknowledgedResult?: unknown,
): TerminalRunControlError {
  const error = new TerminalRunControlError(
    code,
    message,
    status,
    output,
    acknowledgedResult,
    record.callId,
  );
  defineProperties(error, {
    terminalToolCallId: { value: record.callId, writable: false, configurable: false },
    status: { value: error.status, writable: false, configurable: false },
    output: { value: error.output, writable: false, configurable: false },
    acknowledgedResult: { value: error.acknowledgedResult, writable: false, configurable: false },
  });
  apply(weakSetAdd, terminalErrors, [error]);
  apply(weakMapSet, outcomes, [error, record]);
  return error;
}
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const apply = Reflect.apply;

/** Recognize owned control errors without invoking application Proxy hooks. */
export function isTerminalRunControlError(error: unknown): error is TerminalRunControlError {
  return typeof error === "object" && error !== null &&
    apply(weakSetHas, terminalErrors, [error]) === true;
}

type ControlContext = ToolExecutionContext & {
  [controlKey]?: TerminalRunControl;
  [credentialOwnerKey]?: TerminalRunControl | null;
};

/** Preserve the original invocation owner when remote credentials cross delegation boundaries. */
export function bindTerminalRunCredentialOwner(
  context: ToolExecutionContext,
  owner: ToolExecutionContext,
): ToolExecutionContext {
  const ownerControl = owner as ControlContext;
  if (
    !ownerControl[controlKey] && ownerControl[credentialOwnerKey] === undefined &&
    !(context as ControlContext)[controlKey]
  ) return context;
  return {
    ...context,
    [credentialOwnerKey]: ownerControl[credentialOwnerKey] !== undefined
      ? ownerControl[credentialOwnerKey]
      : ownerControl[controlKey] ?? null,
  };
}

/** A delegate's independent terminal control cannot exercise its ancestor's credential. */
export function hasCurrentTerminalRunCredentialAuthority(
  context: ToolExecutionContext | undefined,
): boolean {
  const controlContext = context as ControlContext | undefined;
  const control = controlContext?.[controlKey];
  return !!control && (controlContext?.[credentialOwnerKey] === undefined ||
    controlContext[credentialOwnerKey] === control);
}

/** An authoritative terminal action stops this execution, including sibling tools. */
export class TerminalRunControlError extends Error {
  executionState?: Pick<AgentResponse, "messages" | "toolCalls" | "usage">;
  constructor(
    readonly code: string,
    message: string,
    readonly status: string,
    readonly output?: unknown,
    readonly acknowledgedResult?: unknown,
    readonly terminalToolCallId?: string,
  ) {
    super(message);
    this.name = "TerminalRunControlError";
  }
}

class TerminalRunControl {
  constructor(private readonly validateOutput?: (output: unknown) => Promise<unknown>) {}
  readonly controller = new AbortController();
  pending?: Promise<void>;

  async ready(): Promise<void> {
    if (this.pending) {
      await this.pending;
      return this.ready();
    }
    this.controller.signal.throwIfAborted();
  }

  async dispatch(
    execute: () => Promise<unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    if (this.pending) {
      await this.pending;
      return this.dispatch(execute, context);
    }
    this.controller.signal.throwIfAborted();
    context?.abortSignal?.throwIfAborted();
    return execute();
  }

  async fail(
    input: Record<string, unknown>,
    context: ToolExecutionContext,
    execute: () => Promise<unknown>,
  ): Promise<unknown> {
    const dispatch = apply(weakMapGet, dispatches, [context]) as AdmittedDispatch | undefined;
    if (dispatch?.invocation !== this) {
      throw new Error("finalize requires an admitted runtime tool dispatch");
    }
    const validation = this.validateInput(input);
    if (validation) await validation;
    if (!context.runId || context.runIdBindsToolAuthorization === false) {
      throw new Error("finalize requires authenticated current-run authority");
    }
    return this.commit(context, execute, dispatch);
  }

  private validateInput(input: Record<string, unknown>): Promise<void> | undefined {
    if (input.status === "completed") {
      return this.validateCompletedInput(input);
    } else {
      this.validateFailureInput(input);
    }
  }

  private validateCompletedInput(input: Record<string, unknown>): Promise<void> | undefined {
    if (
      !Object.hasOwn(input, "output") || input.output === undefined ||
      Object.keys(input).some((key) => key !== "status" && key !== "output")
    ) {
      throw new Error("finalize completed requires output, without a run ID");
    }
    if (this.validateOutput) {
      return this.applyOutputSchema(input, this.validateOutput);
    }
    this.snapshotCompletedOutput(input, input.output);
  }

  private async applyOutputSchema(
    input: Record<string, unknown>,
    validateOutput: (output: unknown) => Promise<unknown>,
  ): Promise<void> {
    this.snapshotCompletedOutput(input, await validateOutput(input.output));
  }

  private snapshotCompletedOutput(input: Record<string, unknown>, output: unknown): void {
    const snapshot = snapshotBoundedJsonValue(output);
    if (!snapshot.success) {
      throw new Error("finalize completed requires JSON-compatible output after schema validation");
    }
    input.output = snapshot.value;
  }

  private validateFailureInput(input: Record<string, unknown>): void {
    const error = input.error;
    if (
      input.status !== "failed" || !error || typeof error !== "object" || Array.isArray(error) ||
      Object.keys(input).some((key) => key !== "status" && key !== "error")
    ) {
      throw new Error("finalize requires completed/output or failed/error, without a run ID");
    }
    const failure = error as Record<string, unknown>;
    if (
      typeof failure.code !== "string" || failure.code.length < 1 || failure.code.length > 128 ||
      typeof failure.message !== "string" || failure.message.length < 1 ||
      failure.message.length > 4000 ||
      Object.keys(failure).some((key) =>
        key !== "code" && key !== "message" && key !== "details"
      ) ||
      (failure.details !== undefined &&
        (!failure.details || typeof failure.details !== "object" || Array.isArray(failure.details)))
    ) {
      throw new Error("finalize requires a valid failure code, message and optional JSON details");
    }
    const snapshot = snapshotBoundedJsonValue(failure);
    if (!snapshot.success) throw new Error("finalize failure must be JSON-compatible");
    input.error = snapshot.value;
  }

  private async commit(
    context: ToolExecutionContext,
    execute: () => Promise<unknown>,
    dispatch: AdmittedDispatch,
  ): Promise<unknown> {
    if (this.pending) {
      await this.pending;
      return this.commit(context, execute, dispatch);
    }
    this.controller.signal.throwIfAborted();
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await dispatch.prepare();
      let result: unknown;
      try {
        result = await execute();
      } catch {
        // The first write may have committed before its reply was lost. The
        // same authenticated call reconciles through the idempotent API kernel.
        try {
          result = await execute();
        } catch {
          const error = terminalOutcome(
            dispatch,
            "RUN_OUTCOME_UNKNOWN",
            "Run outcome could not be confirmed",
            "unknown",
          );
          this.controller.abort(error);
          throw error;
        }
      }
      type TerminalResource = {
        id?: string;
        run_id?: string;
        status?: string;
        output?: unknown;
        error?: { code?: string; message?: string };
      };
      const response = result as
        | (TerminalResource & {
          run?: TerminalResource;
        })
        | null;
      const run = response?.run ?? response;
      const canonicalResponseId = apply(weakMapGet, canonicalResponseIds, [this]) as
        | string
        | undefined;
      const matchesRun = response?.run
        ? run?.run_id === context.runId
        : canonicalResponseId !== undefined && run?.id === canonicalResponseId;
      if (
        run && matchesRun &&
        (run.status === "failed" || run.status === "cancelled" ||
          (run.status === "completed" && Object.hasOwn(run, "output")))
      ) {
        const error = terminalOutcome(
          dispatch,
          run.error?.code ?? "RUN_TERMINAL",
          run.error?.message ?? `Run is ${run.status}`,
          run.status,
          run.output,
          result,
        );
        this.controller.abort(error);
        throw error;
      }
      if (hasToolExecutionErrorMarker(result)) return result;
      // A successful but unrecognized reply may follow a committed write.
      // Do not let another model turn turn an uncertain outcome into success.
      const error = terminalOutcome(
        dispatch,
        "RUN_OUTCOME_UNKNOWN",
        "Run outcome could not be confirmed",
        "unknown",
      );
      this.controller.abort(error);
      throw error;
    } finally {
      release();
      this.pending = undefined;
    }
  }
}

/** Preserve the canonical winner when its separate transcript write fails. */
export function terminalReceiptPersistenceFailure(error: unknown, signal?: AbortSignal): unknown {
  const terminalOutcome = signal?.reason;
  if (!isTerminalRunControlError(terminalOutcome) || error === terminalOutcome) return error;
  return new Error(error instanceof Error ? error.message : "Terminal receipt persistence failed", {
    cause: freeze({ persistenceError: error, terminalOutcome }),
  });
}

/** Bind canonical response identity from the private platform credential, never from a tool argument. */
export function bindTerminalRunResponseIdentity(
  context: ToolExecutionContext | undefined,
  canonicalRunId: string,
): void {
  if (!hasCurrentTerminalRunCredentialAuthority(context)) return;
  const control = (context as ControlContext)[controlKey];
  if (!control) return;
  const existing = apply(weakMapGet, canonicalResponseIds, [control]);
  if (existing && existing !== canonicalRunId) {
    throw new Error("Terminal response identity cannot change during execution");
  }
  apply(weakMapSet, canonicalResponseIds, [control, canonicalRunId]);
}

/** Create a gate for one runtime invocation; child invocations receive their own gate. */
export function createTerminalRunControl(
  context: Record<string, unknown> | undefined,
  signal?: AbortSignal,
  validateOutput?: (output: unknown) => Promise<unknown>,
): {
  context: Record<string, unknown>;
  binding: Record<symbol, unknown>;
  signal: AbortSignal;
} {
  const control = new TerminalRunControl(validateOutput);
  return {
    context: { ...context, [controlKey]: control },
    binding: { [controlKey]: control },
    signal: signal
      ? AbortSignal.any([signal, control.controller.signal])
      : control.controller.signal,
  };
}

/** Pause dispatch while an authenticated terminal write is being reconciled. */
export async function awaitTerminalRunControl(context?: ToolExecutionContext): Promise<void> {
  await (context as ControlContext | undefined)?.[controlKey]?.ready();
  context?.abortSignal?.throwIfAborted();
}

/** Check the gate immediately before dispatch, after asynchronous policy/source resolution. */
export async function dispatchWithTerminalRunControl(
  context: ToolExecutionContext | undefined,
  execute: () => Promise<unknown>,
): Promise<unknown> {
  const control = (context as ControlContext | undefined)?.[controlKey];
  if (control) return control.dispatch(execute, context);
  context?.abortSignal?.throwIfAborted();
  return execute();
}

/** Names the finalize call so the API can close it before the run's terminal event. */
export const RUN_TERMINAL_TOOL_CALL_ID_HEADER = "X-Veryfront-Run-Terminal-Tool-Call-Id";
const regExpTest = RegExp.prototype.test;
/** Printable ASCII, bounded: always a valid header value, and what the API accepts. */
const TOOL_CALL_ID_PATTERN = /^[\x21-\x7e]{1,200}$/;

/** The finalize call's id as a header value, or undefined when it is absent or not sendable. */
export function terminalToolCallIdHeaderValue(context?: ToolExecutionContext): string | undefined {
  const toolCallId = context?.toolCallId;
  return typeof toolCallId === "string" &&
      apply(regExpTest, TOOL_CALL_ID_PATTERN, [toolCallId]) === true
    ? toolCallId
    : undefined;
}

export function isTerminalRunToolName(name: string): boolean {
  return name === "veryfront__finalize" || name === "finalize";
}

/** Called only after selecting a trusted platform source and enforcing tool policy. */
export async function executeTerminalRunTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
  execute: () => Promise<unknown>,
): Promise<unknown> {
  if (!isTerminalRunToolName(name)) {
    return dispatchWithTerminalRunControl(context, execute);
  }
  const control = (context as ControlContext | undefined)?.[controlKey];
  if (!control || !context) throw new Error("finalize requires an active runtime execution");
  return control.fail(input, context, execute);
}

/** The API already committed this output; returning it must not start another model turn. */
export function terminalCompletionResponse(
  error: unknown,
  jsonOutput = false,
): AgentResponse | undefined {
  if (!(isTerminalRunControlError(error)) || error.status !== "completed") return undefined;
  return {
    text: typeof error.output === "string" && !jsonOutput
      ? error.output
      : JSON.stringify(error.output) ?? "",
    object: error.output,
    messages: [],
    toolCalls: [],
    ...error.executionState,
    status: "completed",
  };
}
