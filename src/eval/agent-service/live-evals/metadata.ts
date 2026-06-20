import type { LiveEvalCaseMetadata } from "./report.ts";
import type { LiveEvalCase } from "./runner.ts";

/** Public API contract for live eval case surface. */
export type LiveEvalCaseSurface = "read-only" | "write" | "experimental";

/** Public API contract for live eval case tag rule. */
export interface LiveEvalCaseTagRule {
  tag: string;
  equals?: string | readonly string[];
  startsWith?: string | readonly string[];
  includes?: string | readonly string[];
}

/** Options accepted by live eval case metadata. */
export interface LiveEvalCaseMetadataOptions {
  releaseGateCaseIds?: readonly string[] | ReadonlySet<string>;
  optionalJudgeCasePrefixes?: readonly string[];
  areaTagRules?: readonly LiveEvalCaseTagRule[];
}

/** Input payload for build live eval case metadata. */
export interface BuildLiveEvalCaseMetadataInput extends LiveEvalCaseMetadataOptions {
  caseId: string;
  surface: LiveEvalCaseSurface;
  requireProject: boolean;
}

/** Default value for live eval optional judge case prefixes. */
export const DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES: readonly string[] = [
  "knowledge-",
  "grounded-",
  "judged-",
];

/** Default value for live eval area tag rules. */
export const DEFAULT_LIVE_EVAL_AREA_TAG_RULES: readonly LiveEvalCaseTagRule[] = [
  { startsWith: "starter-", tag: "area:starter-routing" },
  { startsWith: "starter-task-", tag: "area:starter-artifact-flow" },
  { startsWith: "starter-", tag: "behavior:conversation-first" },
  { startsWith: "workflow-", tag: "area:workflow" },
  { startsWith: "platform-", tag: "area:platform" },
  { startsWith: "security-", tag: "area:security" },
  { startsWith: ["knowledge-", "grounded-", "judged-"], tag: "area:knowledge" },
  { startsWith: "tool-truthfulness", tag: "area:tool-truthfulness" },
  { startsWith: "degraded-", tag: "area:resilience" },
  { equals: "error-recovery-missing-file", tag: "area:resilience" },
  { includes: "deploy", tag: "area:deployment" },
  { includes: "sandbox", tag: "area:sandbox" },
  { includes: "debug", tag: "area:debugging" },
  { includes: "operate", tag: "area:operations" },
  { includes: "research", tag: "area:research" },
  { includes: "knowledge", tag: "area:knowledge-lifecycle" },
  { includes: "agent", tag: "area:agent-authoring" },
  { includes: "form-input", tag: "area:interactive-input" },
  { includes: ["invoke-agent", "delegation"], tag: "area:delegation" },
  { includes: ["create-page", "create-api-route", "create-skill"], tag: "area:file-generation" },
];

function toStringArray(value: string | readonly string[] | undefined): readonly string[] {
  if (!value) {
    return [];
  }

  return typeof value === "string" ? [value] : value;
}

function caseIdCollectionHas(
  collection: readonly string[] | ReadonlySet<string> | undefined,
  caseId: string,
): boolean {
  if (!collection) {
    return false;
  }

  if ("has" in collection) {
    return collection.has(caseId);
  }

  return collection.includes(caseId);
}

function matchesTagRule(caseId: string, rule: LiveEvalCaseTagRule): boolean {
  for (const value of toStringArray(rule.equals)) {
    if (caseId === value) {
      return true;
    }
  }

  for (const value of toStringArray(rule.startsWith)) {
    if (caseId.startsWith(value)) {
      return true;
    }
  }

  for (const value of toStringArray(rule.includes)) {
    if (caseId.includes(value)) {
      return true;
    }
  }

  return false;
}

function isOptionalJudgeCase(caseId: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => caseId.startsWith(prefix));
}

function buildAreaTags(caseId: string, rules: readonly LiveEvalCaseTagRule[]): string[] {
  const tags = new Set<string>();

  for (const rule of rules) {
    if (matchesTagRule(caseId, rule)) {
      tags.add(rule.tag);
    }
  }

  return [...tags];
}

/** Builds live eval case metadata. */
export function buildLiveEvalCaseMetadata(
  input: BuildLiveEvalCaseMetadataInput,
): LiveEvalCaseMetadata {
  const optionalJudgeCasePrefixes = input.optionalJudgeCasePrefixes ??
    DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES;
  const areaTagRules = input.areaTagRules ?? DEFAULT_LIVE_EVAL_AREA_TAG_RULES;
  const gradingTag = isOptionalJudgeCase(input.caseId, optionalJudgeCasePrefixes)
    ? "grading:deterministic-plus-optional-llm"
    : "grading:deterministic-only";

  const tags = new Set<string>([
    `surface:${input.surface}`,
    input.requireProject ? "project:required" : "project:optional",
    input.surface === "experimental" ? "stability:experimental" : "stability:stable",
    gradingTag,
  ]);

  if (input.surface !== "experimental") {
    tags.add("gate:nightly");
  }

  if (gradingTag === "grading:deterministic-only" && input.surface !== "experimental") {
    tags.add("gate:ci");
  }

  if (caseIdCollectionHas(input.releaseGateCaseIds, input.caseId)) {
    tags.add("gate:release");
  }

  for (const tag of buildAreaTags(input.caseId, areaTagRules)) {
    tags.add(tag);
  }

  return {
    tags: [...tags].sort(),
  };
}

/** Applies live eval metadata. */
export function withLiveEvalMetadata<TCase extends LiveEvalCase>(
  cases: readonly TCase[],
  surface: LiveEvalCaseSurface,
  options: LiveEvalCaseMetadataOptions = {},
): Array<TCase & { metadata: LiveEvalCaseMetadata }> {
  return cases.map((testCase) => ({
    ...testCase,
    metadata: buildLiveEvalCaseMetadata({
      ...options,
      caseId: testCase.id,
      surface,
      requireProject: testCase.requireProject === true,
    }),
  }));
}
