/**
 * Deadline-bounded subprocess runner for the build smokes.
 *
 * The Sentry runtime package smoke shells out to npm, node, and deno. Without a
 * per-command deadline a hung `npm install` consumes the whole CI job budget and
 * surfaces as an opaque job-level "cancelled" that names nothing, so the next
 * reader cannot tell which command stalled. Every invocation carries its own
 * timeout here, and a stalled command fails fast naming itself.
 */

export interface BoundedCommandInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs: number;
}

export interface BoundedCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const decoder = new TextDecoder();

/** Names the command and its deadline so a timeout is attributable in CI logs. */
export function formatBoundedCommandTimeout(
  input: Pick<BoundedCommandInput, "command" | "args" | "timeoutMs">,
): string {
  return `${input.command} ${
    input.args.join(" ")
  } timed out after ${input.timeoutMs}ms`;
}

/**
 * Runs a command and kills it once `timeoutMs` elapses.
 *
 * Aborting the signal terminates the child. Deno may then either resolve
 * `output()` with the killed status or reject, so both paths funnel into the
 * same named timeout error.
 */
export async function runBoundedCommand(
  input: BoundedCommandInput,
): Promise<BoundedCommandResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let output: Deno.CommandOutput | undefined;
  try {
    output = await new Deno.Command(input.command, {
      args: [...input.args],
      cwd: input.cwd,
      env: input.env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: controller.signal,
    }).output();
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
  }

  if (controller.signal.aborted || output === undefined) {
    throw new Error(formatBoundedCommandTimeout(input));
  }

  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}
