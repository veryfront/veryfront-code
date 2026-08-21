export const PROVIDER_EGRESS_DENY_NET =
  "--deny-net=api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.mistral.ai,api.groq.com,api.deepseek.com,openrouter.ai";

export const TEST_FILE_ENV = {
  DENO_TESTING: "1",
  VF_DISABLE_LRU_INTERVAL: "1",
  SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
  REVALIDATION_PER_PROJECT_LIMIT: "0",
  NODE_ENV: "production",
  LOG_FORMAT: "text",
};

export function buildTestFileCommandArgs(rawArgs: string[]): string[] {
  const usesScriptsConfig = rawArgs.some(isScriptsPath);
  const configArgs = usesScriptsConfig
    ? ["--config=scripts/test.deno.json"]
    : ["--preload=src/testing/preload.ts"];

  return [
    "test",
    ...configArgs,
    "--no-check",
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
    env: TEST_FILE_ENV,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.spawn().status;
  if (!status.success) Deno.exit(status.code);
}

if (import.meta.main) {
  await main();
}
