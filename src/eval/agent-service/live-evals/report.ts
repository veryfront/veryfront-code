import type { LiveEvalRuntime } from "./performance.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

const MAX_LIVE_EVAL_CASES = 100_000;

function validateLiveEvalCases<TCase extends { id: string }>(cases: TCase[]): Set<string> {
  if (!Array.isArray(cases) || cases.length > MAX_LIVE_EVAL_CASES) {
    throw INVALID_ARGUMENT.create({
      detail: `Live eval selection accepts at most ${MAX_LIVE_EVAL_CASES} cases`,
    });
  }
  const ids = new Set<string>();
  for (const testCase of cases) {
    if (typeof testCase.id !== "string" || testCase.id.trim().length === 0) {
      throw INVALID_ARGUMENT.create({ detail: "Live eval case id must be a non-empty string" });
    }
    if (ids.has(testCase.id)) {
      throw INVALID_ARGUMENT.create({ detail: `Duplicate live eval case id "${testCase.id}"` });
    }
    ids.add(testCase.id);
  }
  return ids;
}

/** Public API contract for live eval case metadata. */
export interface LiveEvalCaseMetadata {
  tags: readonly string[];
}

/** Public API contract for live eval result for report. */
export interface LiveEvalResultForReport {
  runtime: LiveEvalRuntime;
  status: "pass" | "fail" | "skip";
}

/** Input payload for live eval case selection. */
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

/** Check whether every live eval tag is present. */
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

/** Builds live eval case tag summary. */
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

/** Select live eval cases helper. */
export function selectLiveEvalCases<
  TCase extends { id: string; metadata?: LiveEvalCaseMetadata },
>(
  input: LiveEvalCaseSelectionInput<TCase>,
): TCase[] {
  const knownCaseIds = validateLiveEvalCases(input.allCases);
  for (const requestedCaseId of input.requestedCaseIds) {
    if (!knownCaseIds.has(requestedCaseId)) {
      throw INVALID_ARGUMENT.create({
        detail: `Unknown live eval case id "${requestedCaseId}"`,
      });
    }
  }
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

/** Resolves live eval requested case IDs. */
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

  const caseIds = Object.hasOwn(input.caseSets, requestedCaseSetId)
    ? input.caseSets[requestedCaseSetId]
    : undefined;
  if (!Array.isArray(caseIds)) {
    throw INVALID_ARGUMENT.create({
      detail: `Unknown AG_UI_EVAL_CASE_SET "${requestedCaseSetId}". Known sets: ${
        Object.keys(input.caseSets).join(", ")
      }`,
    });
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

/** Builds live eval runtime summary. */
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

/** Builds live eval status summary. */
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
