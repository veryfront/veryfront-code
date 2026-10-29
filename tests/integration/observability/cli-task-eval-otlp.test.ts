import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const extensionUrl = new URL("extensions/ext-observability-opentelemetry/src/index.ts", root);

type TracePayload = {
  resourceSpans?: { scopeSpans?: { spans?: { name: string }[] }[] }[];
};

async function writeProject(dir: string, requires: readonly string[]): Promise<void> {
  await Deno.mkdir(`${dir}/tasks`);
  await Deno.mkdir(`${dir}/tools`);
  await Deno.mkdir(`${dir}/evals`);
  await Deno.writeTextFile(
    `${dir}/veryfront.config.ts`,
    `import extOpenTelemetry from "${extensionUrl.href}";
// Server bootstrap provides these contracts, so an extension that requires them starts under dev.
const requiresBuiltins = {
  name: "requires-builtin-contracts",
  version: "0.1.0",
  contracts: { requires: ${JSON.stringify(requires)} },
  capabilities: [],
  setup() {},
};
export default { title: "otlp-cli", extensions: [extOpenTelemetry(), requiresBuiltins] };
`,
  );
  await Deno.writeTextFile(
    `${dir}/tasks/traced.ts`,
    `import { trace } from "veryfront/observability";
// Acquired at module scope, before the command wires tracing.
const tracer = trace.getTracer("otlp-cli");
export default {
  name: "Traced task",
  run() {
    tracer.startSpan("cli.task.span").end();
    return { ok: true };
  },
};
`,
  );
  await Deno.writeTextFile(
    `${dir}/tasks/failing.ts`,
    `import { trace } from "veryfront/observability";
const tracer = trace.getTracer("otlp-cli");
export default {
  name: "Failing task",
  run() {
    tracer.startSpan("cli.failing-task.span").end();
    throw new Error("expected failure");
  },
};
`,
  );
  await Deno.writeTextFile(
    `${dir}/tools/echo.ts`,
    `import { defineSchema } from "veryfront/schemas";
import { trace } from "veryfront/observability";
import { tool } from "veryfront/tool";
const tracer = trace.getTracer("otlp-cli");
export default tool({
  description: "Echo the input",
  inputSchema: defineSchema((v) => v.object({ text: v.string() }))(),
  execute: ({ text }) => {
    tracer.startSpan("cli.eval.span").end();
    return { text };
  },
});
`,
  );
  await Deno.writeTextFile(
    `${dir}/evals/echo.eval.ts`,
    `import { datasets, evalTool, metrics } from "veryfront/eval";
export default evalTool({
  name: "Echo",
  target: "tool:echo",
  dataset: datasets.inline([{ id: "hello", input: { text: "hello" } }]),
  input: (example) => example.input,
  metrics: [metrics.agent.calledTool("echo").gate()],
});
`,
  );
}

function cliEnv(endpoint: string): Record<string, string> {
  // Drop inherited telemetry routing so the fixture endpoint is the only one.
  const env = Object.fromEntries(
    Object.entries(Deno.env.toObject()).filter(([key]) =>
      !key.startsWith("OTEL_") && !key.startsWith("DD_")
    ),
  );
  return {
    ...env,
    OTEL_TRACES_ENABLED: "true",
    OTEL_METRICS_ENABLED: "false",
    OTEL_LOGS_ENABLED: "false",
    OTEL_SERVICE_NAME: "otlp-cli",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    VERYFRONT_NO_UPDATE_CHECK: "1",
    VF_DISABLE_LRU_INTERVAL: "1",
  };
}

async function runCli(
  projectDir: string,
  endpoint: string,
  args: readonly string[],
): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      `--config=${fileURLToPath(new URL("deno.json", root))}`,
      "--frozen",
      "--allow-all",
      fileURLToPath(new URL("cli/main.ts", root)),
      ...args,
    ],
    cwd: projectDir,
    clearEnv: true,
    env: cliEnv(endpoint),
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(120_000),
  }).output();
}

// `task` starts the same built-ins as local server bootstrap. `eval` starts a
// narrower set that omits the bundler contracts.
const TASK_REQUIRES = ["EvalReportExporterRegistry", "Bundler", "ModuleLexer"];
const EVAL_REQUIRES = ["EvalReportExporterRegistry"];

const CASES = [
  { label: "task", args: ["task", "traced"], span: "cli.task.span", exitCode: 0 },
  { label: "failing task", args: ["task", "failing"], span: "cli.failing-task.span", exitCode: 1 },
  { label: "eval", args: ["eval", "echo"], span: "cli.eval.span", exitCode: 0 },
] as const;

describe("CLI task and eval OTLP export", () => {
  for (const { label, args, span, exitCode } of CASES) {
    for (const collectorStatus of [200, 400]) {
      const outcome = collectorStatus === 200 ? "flushes before exit" : "keeps its exit code";
      it(`${label} exports spans and ${outcome} when the collector answers ${collectorStatus}`, async () => {
        const spanNames: string[] = [];
        const collector = Deno.serve(
          { hostname: "127.0.0.1", port: 0, onListen() {} },
          async (req) => {
            const payload = await req.json() as TracePayload;
            for (const resource of payload.resourceSpans ?? []) {
              for (const scope of resource.scopeSpans ?? []) {
                for (const exported of scope.spans ?? []) spanNames.push(exported.name);
              }
            }
            return Response.json({}, { status: collectorStatus });
          },
        );
        const projectDir = await makeTempDirWithOptions({ prefix: "vf-otlp-cli-" });
        try {
          await writeProject(projectDir, args[0] === "task" ? TASK_REQUIRES : EVAL_REQUIRES);
          const output = await runCli(
            projectDir,
            `http://127.0.0.1:${collector.addr.port}`,
            args,
          );
          const decoder = new TextDecoder();
          assertEquals(
            output.code,
            exitCode,
            `${decoder.decode(output.stdout)}\n${decoder.decode(output.stderr)}`,
          );
          assertEquals(spanNames.includes(span), true, `received spans: ${spanNames}`);
        } finally {
          await collector.shutdown();
          await Deno.remove(projectDir, { recursive: true });
        }
      });
    }
  }
});
