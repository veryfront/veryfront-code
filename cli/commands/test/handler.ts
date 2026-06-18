import { defineSchema, lazySchema } from "veryfront/schemas";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess } from "#cli/utils";
import { runCommand } from "veryfront/platform";
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

  const result = await runCommand("deno", {
    args: [
      "test",
      "--no-check",
      "--allow-all",
      "--unstable-worker-options",
      "--unstable-net",
      ...(opts.parallel ? ["--parallel"] : []),
      ...(opts.filter ? [`--filter=${opts.filter}`] : []),
    ],
    capture: true,
    env: {
      VF_DISABLE_LRU_INTERVAL: "1",
      SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
      REVALIDATION_PER_PROJECT_LIMIT: "0",
      NODE_ENV: "production",
      LOG_FORMAT: "text",
    },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const fullOutput = stdout + "\n" + stderr;
  const parsed = parseTestOutput(fullOutput, result.code);
  const noTestModules = result.code !== 0 && parsed.success &&
    fullOutput.includes("No test modules found");

  if (isJsonMode()) {
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
    if (noTestModules) {
      console.log("No test modules found.");
    } else {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    }
  }

  exitProcess(parsed.success ? 0 : result.code);
}
