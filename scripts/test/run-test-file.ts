import {
  buildTestProcessEnv,
  DENO_TEST_ENV,
  LOOPBACK_ALLOW_NET,
  LOOPBACK_TEST_PERMISSIONS,
  PROVIDER_EGRESS_DENY_NET,
  UNIT_DENO_TEST_ENV,
} from "./suites.ts";

export { LOOPBACK_ALLOW_NET, PROVIDER_EGRESS_DENY_NET };

export const TEST_FILE_ENV = UNIT_DENO_TEST_ENV;

export function buildTestFileCommandArgs(rawArgs: string[]): string[] {
  const usesScriptsConfig = rawArgs.some(isScriptsPath);
  const usesIntegrationPermissions = rawArgs.some(isIntegrationPath);
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
    ...(usesIntegrationPermissions
      ? ["--allow-all", PROVIDER_EGRESS_DENY_NET]
      : LOOPBACK_TEST_PERMISSIONS),
    "--unstable-worker-options",
    "--unstable-net",
    ...rawArgs,
  ];
}

function isScriptsPath(arg: string): boolean {
  const normalized = arg.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized === "scripts" || normalized.startsWith("scripts/");
}

function isIntegrationPath(arg: string): boolean {
  const normalized = arg.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized === "tests" || normalized.startsWith("tests/");
}

async function main(): Promise<void> {
  const environment = Deno.args.some(isIntegrationPath) ? DENO_TEST_ENV : UNIT_DENO_TEST_ENV;
  const command = new Deno.Command("deno", {
    args: buildTestFileCommandArgs(Deno.args),
    clearEnv: true,
    env: buildTestProcessEnv(Deno.env.toObject(), environment),
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.spawn().status;
  if (!status.success) Deno.exit(status.code);
}

if (import.meta.main) {
  await main();
}
