import type { LiveEvalRuntime } from "./performance.ts";

export interface LiveEvalCaseMetadata {
  tags: readonly string[];
}

export interface LiveEvalResultForReport {
  runtime: LiveEvalRuntime;
  status: "pass" | "fail" | "skip";
}

export interface LiveEvalCaseSelectionInput<TCase extends { id: string }> {
  allCases: TCase[];
  readOnlyCases: TCase[];
  writeCases: TCase[];
  experimentalWriteCases: TCase[];
  requestedCaseIds: Set<string>;
  requestedCaseTags?: Set<string>;
  runWriteEvals: boolean;
  runExperimentalWriteEvals: boolean;
}

export function hasEveryLiveEvalTag(
  tags: readonly string[],
  requestedTags: Set<string>,
): boolean {
  for (const requestedTag of requestedTags) {
    if (!tags.includes(requestedTag)) {
      return false;
    }
  }

  return true;
}

export function buildLiveEvalCaseTagSummary(
  cases: readonly {
    metadata?: LiveEvalCaseMetadata;
  }[],
): Record<string, number> {
  const counts = new Map<string, number>();

  for (const testCase of cases) {
    const caseTags = testCase.metadata?.tags ?? [];
    for (const tag of caseTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function selectLiveEvalCases<
  TCase extends { id: string; metadata?: LiveEvalCaseMetadata },
>(
  input: LiveEvalCaseSelectionInput<TCase>,
): TCase[] {
  const configuredCases = input.runWriteEvals
    ? [
      ...input.readOnlyCases,
      ...input.writeCases,
      ...(input.runExperimentalWriteEvals ? input.experimentalWriteCases : []),
    ]
    : input.readOnlyCases;

  const selectedCases = input.requestedCaseIds.size > 0
    ? input.allCases.filter((testCase) => input.requestedCaseIds.has(testCase.id))
    : configuredCases;

  const requestedCaseTags = input.requestedCaseTags ?? new Set<string>();

  return requestedCaseTags.size > 0
    ? selectedCases.filter((testCase) =>
      hasEveryLiveEvalTag(testCase.metadata?.tags ?? [], requestedCaseTags)
    )
    : selectedCases;
}

export function resolveLiveEvalRequestedCaseIds(input: {
  caseSets: Record<string, readonly string[]>;
  requestedCaseIds: Set<string>;
  requestedCaseSetId?: string | null;
}): Set<string> {
  const resolved = new Set(input.requestedCaseIds);
  const requestedCaseSetId = input.requestedCaseSetId?.trim();

  if (!requestedCaseSetId) {
    return resolved;
  }

  const caseIds = input.caseSets[requestedCaseSetId];
  if (!caseIds) {
    throw new Error(
      `Unknown AG_UI_EVAL_CASE_SET "${requestedCaseSetId}". Known sets: ${
        Object.keys(input.caseSets).join(", ")
      }`,
    );
  }

  for (const caseId of caseIds) {
    resolved.add(caseId);
  }

  return resolved;
}

interface LiveEvalRuntimeCounts {
  passed: number;
  failed: number;
  skipped: number;
}

function buildRuntimeCounts(
  results: LiveEvalResultForReport[],
  runtime: LiveEvalRuntime,
): LiveEvalRuntimeCounts {
  return {
    passed:
      results.filter((result) => result.runtime === runtime && result.status === "pass").length,
    failed:
      results.filter((result) => result.runtime === runtime && result.status === "fail").length,
    skipped:
      results.filter((result) => result.runtime === runtime && result.status === "skip").length,
  };
}

export function buildLiveEvalRuntimeSummary(
  runtimes: readonly LiveEvalRuntime[],
  results: LiveEvalResultForReport[],
): Record<LiveEvalRuntime, LiveEvalRuntimeCounts> {
  const empty: LiveEvalRuntimeCounts = { passed: 0, failed: 0, skipped: 0 };
  const summary: Record<LiveEvalRuntime, LiveEvalRuntimeCounts> = {
    framework: empty,
  };
  for (const runtime of runtimes) {
    summary[runtime] = buildRuntimeCounts(results, runtime);
  }
  return summary;
}

export function buildLiveEvalStatusSummary(
  results: LiveEvalResultForReport[],
): {
  passed: number;
  failed: number;
  skipped: number;
} {
  return {
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    skipped: results.filter((result) => result.status === "skip").length,
  };
}
