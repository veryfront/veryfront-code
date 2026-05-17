const CIRCULAR_DEPENDENCY_BASELINE = 0;

export function parseCircularDependencyCount(output: string): number {
  const match = output.match(/(\d+)\s+circular dependencies detected/);
  if (!match) return 0;
  return Number(match[1]);
}

export function isWithinCircularDependencyBaseline(count: number, baseline: number): boolean {
  return count <= baseline;
}

export interface CircularDependencyCheckResult {
  ok: boolean;
  count: number | null;
  reason?: "command_failed" | "baseline_exceeded";
}

export function getCircularDependencyCheckResult(
  opts: { commandSucceeded: boolean; output: string; baseline: number },
): CircularDependencyCheckResult {
  const match = opts.output.match(/(\d+)\s+circular dependencies detected/);
  const count = match ? Number(match[1]) : opts.commandSucceeded ? 0 : null;

  if (!opts.commandSucceeded) {
    return { ok: false, count, reason: "command_failed" };
  }

  if (count !== null && !isWithinCircularDependencyBaseline(count, opts.baseline)) {
    return { ok: false, count, reason: "baseline_exceeded" };
  }

  return { ok: true, count };
}

async function main(): Promise<void> {
  const command = new Deno.Command("deno", {
    args: ["run", "-A", "jsr:@cunarist/deno-circular-deps", "src/index.ts"],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  const output = `${stdout}${stderr}`;
  const check = getCircularDependencyCheckResult({
    commandSucceeded: result.success,
    output,
    baseline: CIRCULAR_DEPENDENCY_BASELINE,
  });

  if (!check.ok) {
    console.error(output.trim());
    if (check.reason === "command_failed") {
      console.error("Circular dependency command failed.");
    } else {
      console.error(
        `Circular dependency count ${check.count} exceeds baseline ${CIRCULAR_DEPENDENCY_BASELINE}.`,
      );
    }
    Deno.exit(1);
  }

  console.log(
    `Circular dependency baseline ok: ${check.count}/${CIRCULAR_DEPENDENCY_BASELINE}.`,
  );
}

if (import.meta.main) {
  await main();
}
