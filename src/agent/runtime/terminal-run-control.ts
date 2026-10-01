import type { AgentResponse } from "#veryfront/agent/types.ts";
import { hasToolExecutionErrorMarker } from "#veryfront/tool/result.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";

const controlKey = Symbol("terminal-run-control");
const terminalErrors = new WeakSet<object>();
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const apply = Reflect.apply;

/** Recognize owned control errors without invoking application Proxy hooks. */
export function isTerminalRunControlError(error: unknown): error is TerminalRunControlError {
  return typeof error === "object" && error !== null &&
    apply(weakSetHas, terminalErrors, [error]) === true;
}

type ControlContext = ToolExecutionContext & { [controlKey]?: TerminalRunControl };

/** An authoritative terminal action stops this execution, including sibling tools. */
export class TerminalRunControlError extends Error {
  executionState?: Pick<AgentResponse, "messages" | "toolCalls" | "usage">;
  constructor(
    readonly code: string,
    message: string,
    readonly status: string,
    readonly output?: unknown,
    readonly acknowledgedResult?: unknown,
    readonly acknowledgedToolCallId?: string,
  ) {
    super(message);
    this.name = "TerminalRunControlError";
    apply(weakSetAdd, terminalErrors, [this]);
  }
}

class TerminalRunControl {
  constructor(private readonly validateOutput?: (output: unknown) => Promise<unknown>) {}
  readonly controller = new AbortController();
  pending?: Promise<void>;

  async ready(): Promise<void> {
    while (this.pending) await this.pending;
    this.controller.signal.throwIfAborted();
  }

  async dispatch(
    execute: () => Promise<unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    while (this.pending) await this.pending;
    this.controller.signal.throwIfAborted();
    context?.abortSignal?.throwIfAborted();
    return execute();
  }

  async fail(
    input: Record<string, unknown>,
    context: ToolExecutionContext,
    execute: () => Promise<unknown>,
  ): Promise<unknown> {
    if (input.status === "completed") {
      if (
        !Object.hasOwn(input, "output") || input.output === undefined ||
        Object.keys(input).some((key) => key !== "status" && key !== "output")
      ) {
        throw new Error("finalized completed requires output, without a run ID");
      }
      if (this.validateOutput) input.output = await this.validateOutput(input.output);
    } else {
      const error = input.error;
      if (
        input.status !== "failed" || !error || typeof error !== "object" || Array.isArray(error) ||
        Object.keys(input).some((key) => key !== "status" && key !== "error")
      ) {
        throw new Error("finalized requires completed/output or failed/error, without a run ID");
      }
      const failure = error as Record<string, unknown>;
      if (
        typeof failure.code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(failure.code) ||
        typeof failure.message !== "string" || !failure.message.trim() ||
        failure.message.length > 2000 ||
        Object.keys(failure).some((key) => key !== "code" && key !== "message")
      ) {
        throw new Error("finalized requires a valid failure code and message");
      }
    }
    if (!context.runId || context.runIdBindsToolAuthorization === false) {
      throw new Error("finalized requires authenticated current-run authority");
    }
    while (this.pending) await this.pending;
    this.controller.signal.throwIfAborted();
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      let result: unknown;
      try {
        result = await execute();
      } catch {
        // The first write may have committed before its reply was lost. The
        // same authenticated call reconciles through the idempotent API kernel.
        try {
          result = await execute();
        } catch {
          const error = new TerminalRunControlError(
            "RUN_OUTCOME_UNKNOWN",
            "Run outcome could not be confirmed",
            "unknown",
          );
          this.controller.abort(error);
          throw error;
        }
      }
      const response = result as {
        run?: {
          run_id?: string;
          status?: string;
          output?: unknown;
          error?: { code?: string; message?: string };
        };
      } | null;
      const run = response?.run;
      if (
        run?.run_id === context.runId &&
        (run.status === "failed" || run.status === "cancelled" ||
          (run.status === "completed" && Object.hasOwn(run, "output")))
      ) {
        const error = new TerminalRunControlError(
          run.error?.code ?? "RUN_TERMINAL",
          run.error?.message ?? `Run is ${run.status}`,
          run.status,
          run.output,
          result,
          context.toolCallId,
        );
        this.controller.abort(error);
        throw error;
      }
      if (hasToolExecutionErrorMarker(result)) return result;
      // A successful but unrecognized reply may follow a committed write.
      // Do not let another model turn turn an uncertain outcome into success.
      const error = new TerminalRunControlError(
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

/** Called only after selecting a trusted platform source and enforcing tool policy. */
export async function executeTerminalRunTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
  execute: () => Promise<unknown>,
): Promise<unknown> {
  if (name !== "veryfront__finalized" && name !== "finalized") {
    return dispatchWithTerminalRunControl(context, execute);
  }
  const control = (context as ControlContext | undefined)?.[controlKey];
  if (!control || !context) throw new Error("finalized requires an active runtime execution");
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
