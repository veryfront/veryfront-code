import type {
  EvalToolLoadingBenchmarkAssertion,
  EvalToolLoadingBenchmarkComparison,
  EvalToolLoadingBenchmarkRecord,
  EvalUsage,
  EvalUsageProvider,
} from "./types.ts";

const MAX_DEFERRED_EFFECTIVE_INPUT_TOKENS = 10_000;
const MIN_EFFECTIVE_INPUT_REDUCTION = 0.6;

/** Calculate provider-aware effective input tokens without double-counting OpenAI cache tokens. */
export function calculateEffectiveInputTokens(
  provider: EvalUsageProvider,
  usage: EvalUsage,
): number | undefined {
  if (usage.inputTokens === undefined) return undefined;
  if (provider === "openai") return usage.inputTokens;
  return usage.inputTokens +
    (usage.cacheCreationInputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0);
}

function assertion(
  name: string,
  pass: boolean,
  actual: number | string | boolean,
  expected: string,
): EvalToolLoadingBenchmarkAssertion {
  return { name, status: pass ? "passed" : "failed", pass, actual, expected };
}

function incompleteAssertion(
  name: string,
  expected: string,
): EvalToolLoadingBenchmarkAssertion {
  return { name, status: "incomplete", expected };
}

function sameControlledInput(
  eager: EvalToolLoadingBenchmarkRecord,
  deferred: EvalToolLoadingBenchmarkRecord,
): boolean {
  return eager.prompt === deferred.prompt &&
    eager.provider === deferred.provider &&
    eager.model === deferred.model &&
    eager.sourceRevision === deferred.sourceRevision &&
    eager.catalogFingerprint === deferred.catalogFingerprint &&
    eager.catalogSourceRevision === deferred.catalogSourceRevision;
}

function hasCompleteUsage(record: EvalToolLoadingBenchmarkRecord): boolean {
  const cacheFieldsComplete = record.provider === "anthropic"
    ? record.usage.cacheCreationInputTokens !== undefined &&
      record.usage.cacheReadInputTokens !== undefined
    : record.usage.cacheReadInputTokens !== undefined &&
      record.usage.cacheWriteInputTokens !== undefined;
  return record.usage.usageCaptureStatus === "complete" &&
    record.usage.inputTokens !== undefined &&
    record.usage.billableInputTokens !== undefined &&
    record.usage.providerInputCostUsd !== undefined &&
    cacheFieldsComplete;
}

/** Compare controlled eager and deferred observations against the release gates. */
export function compareToolLoadingBenchmark(
  eager: EvalToolLoadingBenchmarkRecord,
  deferred: EvalToolLoadingBenchmarkRecord,
): EvalToolLoadingBenchmarkComparison {
  const controlledInputsMatch = sameControlledInput(eager, deferred);
  const eagerEffectiveInputTokens = calculateEffectiveInputTokens(eager.provider, eager.usage);
  const deferredEffectiveInputTokens = calculateEffectiveInputTokens(
    deferred.provider,
    deferred.usage,
  );
  const effectiveInputReduction = eagerEffectiveInputTokens !== undefined &&
      deferredEffectiveInputTokens !== undefined && eagerEffectiveInputTokens > 0
    ? (eagerEffectiveInputTokens - deferredEffectiveInputTokens) / eagerEffectiveInputTokens
    : undefined;

  const assertions: EvalToolLoadingBenchmarkAssertion[] = [
    assertion(
      "controlled-inputs-match",
      controlledInputsMatch,
      controlledInputsMatch,
      "same prompt, provider, model, source revision, and catalog",
    ),
  ];

  const completeUsage = hasCompleteUsage(eager) && hasCompleteUsage(deferred);
  assertions.push(
    completeUsage
      ? assertion("usage-capture-complete", true, true, "complete for eager and deferred")
      : incompleteAssertion("usage-capture-complete", "complete for eager and deferred"),
  );

  if (deferredEffectiveInputTokens === undefined) {
    assertions.push(
      incompleteAssertion(
        "deferred-effective-input-limit",
        `effective input tokens <= ${MAX_DEFERRED_EFFECTIVE_INPUT_TOKENS}`,
      ),
    );
  } else {
    assertions.push(assertion(
      "deferred-effective-input-limit",
      deferredEffectiveInputTokens <= MAX_DEFERRED_EFFECTIVE_INPUT_TOKENS,
      deferredEffectiveInputTokens,
      `<= ${MAX_DEFERRED_EFFECTIVE_INPUT_TOKENS}`,
    ));
  }

  if (effectiveInputReduction === undefined) {
    assertions.push(
      incompleteAssertion(
        "effective-input-reduction",
        `reduction >= ${MIN_EFFECTIVE_INPUT_REDUCTION}`,
      ),
    );
  } else {
    assertions.push(assertion(
      "effective-input-reduction",
      effectiveInputReduction >= MIN_EFFECTIVE_INPUT_REDUCTION,
      effectiveInputReduction,
      `>= ${MIN_EFFECTIVE_INPUT_REDUCTION}`,
    ));
  }

  const eagerProviderInputCost = eager.usage.providerInputCostUsd;
  const deferredProviderInputCost = deferred.usage.providerInputCostUsd;
  if (eagerProviderInputCost === undefined || deferredProviderInputCost === undefined) {
    assertions.push(
      incompleteAssertion("provider-input-cost-lower", "deferred cost < eager cost"),
    );
  } else {
    assertions.push(assertion(
      "provider-input-cost-lower",
      deferredProviderInputCost < eagerProviderInputCost,
      deferredProviderInputCost,
      `< ${eagerProviderInputCost}`,
    ));
  }

  assertions.push(
    assertion(
      "modes-are-eager-and-deferred",
      eager.mode === "eager" && deferred.mode === "deferred",
      `${eager.mode}/${deferred.mode}`,
      "eager/deferred",
    ),
    assertion("eager-completed", eager.completed, eager.completed, "true"),
    assertion("eager-one-step", eager.steps === 1, eager.steps, "1"),
    assertion("eager-no-tool-calls", eager.toolCalls === 0, eager.toolCalls, "0"),
    assertion("deferred-completed", deferred.completed, deferred.completed, "true"),
    assertion("deferred-one-step", deferred.steps === 1, deferred.steps, "1"),
    assertion("deferred-no-tool-calls", deferred.toolCalls === 0, deferred.toolCalls, "0"),
    assertion(
      "model-context-definitions-reduced",
      deferred.providerRequestToolDefinitionCount < eager.providerRequestToolDefinitionCount,
      deferred.providerRequestToolDefinitionCount,
      `< ${eager.providerRequestToolDefinitionCount}`,
    ),
    assertion(
      "authorized-catalog-preserved",
      deferred.authorizedSearchableSchemaCount === eager.authorizedSearchableSchemaCount,
      deferred.authorizedSearchableSchemaCount,
      `${eager.authorizedSearchableSchemaCount}`,
    ),
    assertion(
      "eager-schema-counts-consistent",
      eager.visibleSchemaCount + eager.deferredSchemaCount ===
        eager.authorizedSearchableSchemaCount,
      eager.visibleSchemaCount + eager.deferredSchemaCount,
      `${eager.authorizedSearchableSchemaCount}`,
    ),
    assertion(
      "deferred-schema-counts-consistent",
      deferred.visibleSchemaCount + deferred.deferredSchemaCount ===
        deferred.authorizedSearchableSchemaCount,
      deferred.visibleSchemaCount + deferred.deferredSchemaCount,
      `${deferred.authorizedSearchableSchemaCount}`,
    ),
  );

  let status: EvalToolLoadingBenchmarkComparison["status"] = "passed";
  if (assertions.some((item) => item.status === "incomplete")) {
    status = "incomplete";
  } else if (assertions.some((item) => item.pass === false)) {
    status = "failed";
  }

  return {
    kind: "eval-tool-loading-benchmark-comparison",
    status,
    eager,
    deferred,
    ...(eagerEffectiveInputTokens !== undefined ? { eagerEffectiveInputTokens } : {}),
    ...(deferredEffectiveInputTokens !== undefined ? { deferredEffectiveInputTokens } : {}),
    ...(effectiveInputReduction !== undefined ? { effectiveInputReduction } : {}),
    assertions,
  };
}

function integer(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("en-US");
}

function signedInteger(value: number | undefined): string {
  if (value === undefined) return "-";
  const formatted = integer(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function comparisonRow(
  label: string,
  eager: number | undefined,
  deferred: number | undefined,
): string {
  const delta = eager === undefined || deferred === undefined ? undefined : deferred - eager;
  return `| ${label} | ${integer(eager)} | ${integer(deferred)} | ${signedInteger(delta)} |`;
}

/** Render one reproducible comparison with raw usage and request-shape evidence together. */
export function createToolLoadingBenchmarkMarkdown(
  comparison: EvalToolLoadingBenchmarkComparison,
): string {
  const eager = comparison.eager;
  const deferred = comparison.deferred;
  const lines = [
    "# Tool-loading benchmark",
    "",
    `Status: \`${comparison.status}\``,
    `Prompt: \`${eager.prompt}\``,
    `Model: \`${eager.model}\``,
    `Source revision: \`${eager.sourceRevision}\``,
    `Catalog fingerprint: \`${eager.catalogFingerprint}\``,
    `Catalog source revision: \`${eager.catalogSourceRevision}\``,
    `Usage capture: eager=\`${eager.usage.usageCaptureStatus ?? "missing"}\`, deferred=\`${
      deferred.usage.usageCaptureStatus ?? "missing"
    }\``,
    `Completion: eager=\`${eager.completed}\`, deferred=\`${deferred.completed}\``,
    ...(comparison.effectiveInputReduction === undefined ? [] : [
      `Effective input reduction: \`${(comparison.effectiveInputReduction * 100).toFixed(2)}%\``,
    ]),
    "",
    "| Measurement | Eager | Deferred | Delta |",
    "| --- | ---: | ---: | ---: |",
    comparisonRow("Input tokens", eager.usage.inputTokens, deferred.usage.inputTokens),
    comparisonRow(
      "Cache creation input tokens",
      eager.usage.cacheCreationInputTokens,
      deferred.usage.cacheCreationInputTokens,
    ),
    comparisonRow(
      "Cache read input tokens",
      eager.usage.cacheReadInputTokens,
      deferred.usage.cacheReadInputTokens,
    ),
    comparisonRow(
      "Cache write input tokens",
      eager.usage.cacheWriteInputTokens,
      deferred.usage.cacheWriteInputTokens,
    ),
    comparisonRow(
      "Effective input tokens",
      comparison.eagerEffectiveInputTokens,
      comparison.deferredEffectiveInputTokens,
    ),
    comparisonRow(
      "Billable input tokens",
      eager.usage.billableInputTokens,
      deferred.usage.billableInputTokens,
    ),
    comparisonRow(
      "Provider input cost USD",
      eager.usage.providerInputCostUsd,
      deferred.usage.providerInputCostUsd,
    ),
    comparisonRow(
      "Authorized searchable schemas",
      eager.authorizedSearchableSchemaCount,
      deferred.authorizedSearchableSchemaCount,
    ),
    comparisonRow("Visible schemas", eager.visibleSchemaCount, deferred.visibleSchemaCount),
    comparisonRow("Deferred schemas", eager.deferredSchemaCount, deferred.deferredSchemaCount),
    comparisonRow(
      "Model-context tool definitions",
      eager.providerRequestToolDefinitionCount,
      deferred.providerRequestToolDefinitionCount,
    ),
    comparisonRow(
      "Provider HTTP wire deferred metadata",
      eager.providerWireDeferredMetadataCount,
      deferred.providerWireDeferredMetadataCount,
    ),
    comparisonRow("Steps", eager.steps, deferred.steps),
    comparisonRow("Tool calls", eager.toolCalls, deferred.toolCalls),
    comparisonRow("Duration ms", eager.durationMs, deferred.durationMs),
    "",
    "## Assertions",
    "",
    "| Assertion | Status | Actual | Expected |",
    "| --- | --- | ---: | --- |",
    ...comparison.assertions.map((item) =>
      `| ${item.name} | ${item.status} | ${item.actual ?? "-"} | ${item.expected} |`
    ),
    "",
  ];
  return lines.join("\n");
}
