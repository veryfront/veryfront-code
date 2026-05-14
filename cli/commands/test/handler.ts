import { defineSchema, lazySchema } from "veryfront/schemas";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  isJsonMode,
  outputJson,
} from "../../shared/json-output.ts";
import { parseTestOutput } from "./command.ts";

const getTestArgsSchema = defineSchema((v) =>
  v.object({
    filter: v.string().optional(),
    parallel: v.boolean().default(false),
  })
);

const TestArgsSchema = lazySchema(getTestArgsSchema);

const parseTestArgs = createArgParser(TestArgsSchema, {
  filter: { keys: ["filter"], type: "string", positional: 0 },
  parallel: { keys: ["parallel"], type: "boolean" },
});

export async function handleTestCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseTestArgs, "test", args);

  const cmd = new Deno.Command("deno", {
    args: [
      "test",
      "--no-check",
      "--allow-all",
      "--unstable-worker-options",
      "--unstable-net",
      ...(opts.parallel ? ["--parallel"] : []),
      ...(opts.filter ? [`--filter=${opts.filter}`] : []),
    ],
    stdout: "piped",
    stderr: "piped",
    env: {
      VF_DISABLE_LRU_INTERVAL: "1",
      SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
      REVALIDATION_PER_PROJECT_LIMIT: "0",
      NODE_ENV: "production",
      LOG_FORMAT: "text",
    },
  });

  const result = await cmd.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  const fullOutput = stdout + "\n" + stderr;

  if (isJsonMode()) {
    const parsed = parseTestOutput(fullOutput, result.code);
    if (parsed.success) {
      await outputJson(createSuccessEnvelope("test", parsed));
    } else {
      await outputJson(createErrorEnvelope("test", {
        code: "TEST_FAILURE",
        slug: "tests-failed",
        message: `${parsed.summary.failed} test(s) failed`,
        context: parsed as unknown as Record<string, unknown>,
      }));
    }
  } else {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  }

  Deno.exit(result.code);
}
