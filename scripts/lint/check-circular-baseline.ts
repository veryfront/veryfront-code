const CIRCULAR_DEPENDENCY_BASELINE = 0;

export function parseCircularDependencyCount(output: string): number {
  const match = output.match(/(\d+)\s+circular dependencies detected/);
  if (!match) return 0;
  return Number(match[1]);
}

export function isWithinCircularDependencyBaseline(count: number, baseline: number): boolean {
  return count <= baseline;
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
  const count = parseCircularDependencyCount(output);

  if (!isWithinCircularDependencyBaseline(count, CIRCULAR_DEPENDENCY_BASELINE)) {
    console.error(output.trim());
    console.error(
      `Circular dependency count ${count} exceeds baseline ${CIRCULAR_DEPENDENCY_BASELINE}.`,
    );
    Deno.exit(1);
  }

  console.log(
    `Circular dependency baseline ok: ${count}/${CIRCULAR_DEPENDENCY_BASELINE}.`,
  );
}

if (import.meta.main) {
  await main();
}
