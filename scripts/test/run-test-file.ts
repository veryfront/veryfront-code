import { DENO_TEST_ENV, PROVIDER_EGRESS_DENY_NET } from "./suites.ts";

export { PROVIDER_EGRESS_DENY_NET };

export const TEST_FILE_ENV = DENO_TEST_ENV;

export function buildTestFileCommandArgs(rawArgs: string[]): string[] {
  const usesScriptsConfig = rawArgs.some(isScriptsPath);
  const configArgs = usesScriptsConfig
    ? ["--config=scripts/test.deno.json"]
    : ["--preload=src/testing/preload.ts"];

  return [
    "test",
    ...configArgs,
    "--no-check",
    // Leaks here are load-dependent and do not reproduce on demand, so the
    // first failure has to carry the stack rather than advise a rerun.
    "--trace-leaks",
    "--allow-all",
    PROVIDER_EGRESS_DENY_NET,
    "--unstable-worker-options",
    "--unstable-net",
    ...rawArgs,
  ];
}

function isScriptsPath(arg: string): boolean {
  const normalized = arg.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized === "scripts" || normalized.startsWith("scripts/");
}

async function main(): Promise<void> {
  const command = new Deno.Command("deno", {
    args: buildTestFileCommandArgs(Deno.args),
    env: { ...TEST_FILE_ENV },
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.spawn().status;
  if (!status.success) Deno.exit(status.code);
}

if (import.meta.main) {
  await main();
}
