import { createEvalCheckContext } from "./expect.ts";
import { createEvalReport } from "./report.ts";
import type {
  EvalAgentAdapterResult,
  EvalDefinition,
  EvalMetricResult,
  EvalRecord,
  EvalTrace,
  EvalUsage,
  RunEvalOptions,
} from "./types.ts";

function createRunId(now: Date): string {
  return `evalrun_${now.toISOString().replace(/[-:.]/g, "").replace("T", "_").replace("Z", "")}`;
}

function normalizeTrace(trace?: Partial<EvalTrace>): EvalTrace {
  return {
    events: trace?.events ?? [],
    toolCalls: trace?.toolCalls ?? [],
  };
}

function normalizeUsage(usage?: EvalUsage): EvalUsage {
  return usage ?? {};
}

function normalizeAdapterResult(result: string | EvalAgentAdapterResult): EvalAgentAdapterResult {
  return typeof result === "string" ? { text: result } : result;
}

function normalizeOutput(result: EvalAgentAdapterResult): unknown {
  if (Object.hasOwn(result, "output")) return result.output;
  if (Object.hasOwn(result, "json")) return { json: result.json };
  if (Object.hasOwn(result, "text")) return { text: result.text };
  return result;
}

function isBlockingFailure(record: EvalRecord): boolean {
  return [...(record.metrics ?? []), ...(record.checks ?? [])].some((result) =>
    !result.skipped && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget")
  );
}

async function runRecord(
  definition: EvalDefinition,
  options: RunEvalOptions,
  example: Awaited<ReturnType<EvalDefinition["dataset"]["load"]>>[number],
  repetition: number,
): Promise<EvalRecord> {
  const started = Date.now();
  let result: EvalAgentAdapterResult;

  try {
    result = normalizeAdapterResult(
      await options.adapters.agent({ definition, example, repetition }),
    );
  } catch (error) {
    result = {
      text: "",
      completed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const output = normalizeOutput(result);
  const record: EvalRecord = {
    id: `${example.id}:${repetition}`,
    evalId: definition.id,
    exampleId: example.id,
    repetition,
    input: example.input,
    output,
    ...(Object.hasOwn(example, "reference") ? { reference: example.reference } : {}),
    metadata: example.metadata ?? {},
    trace: normalizeTrace(result.trace),
    usage: normalizeUsage(result.usage),
    durationMs: result.durationMs ?? Date.now() - started,
    completed: result.completed ?? !result.error,
    ...(result.error ? { error: result.error } : {}),
  };

  const metricResults = [];
  for (const metric of definition.metrics) {
    metricResults.push(await metric.evaluate(record));
  }
  record.metrics = metricResults;

  const checks: EvalMetricResult[] = [];
  if (definition.check) {
    await definition.check(createEvalCheckContext({
      definition,
      example,
      repetition,
      record,
      checks,
    }));
  }
  record.checks = checks;

  if (isBlockingFailure(record)) {
    record.completed = record.completed && true;
  }

  return record;
}

/** Execute an eval locally with injected target adapters. */
export async function runEval(
  definition: EvalDefinition,
  options: RunEvalOptions,
) {
  const startedAt = options.now?.() ?? new Date();
  const baseDir = options.baseDir ?? Deno.cwd();
  const examples = await definition.dataset.load({ baseDir });
  const records: EvalRecord[] = [];

  for (const example of examples) {
    for (let repetition = 1; repetition <= definition.repetitions; repetition += 1) {
      records.push(await runRecord(definition, options, example, repetition));
    }
  }

  const endedAt = options.now?.() ?? new Date();
  return createEvalReport({
    definition,
    records,
    runId: options.runId ?? createRunId(startedAt),
    startedAt,
    endedAt,
  });
}
