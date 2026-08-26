import type { LiveEvalCaseMetadata } from "./report.ts";
import type { LiveEvalCase } from "./runner.ts";
import {
  createEvalValidationError,
  isEvalRecord,
  normalizeEvalString,
  normalizeEvalStringList,
} from "../../validation.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

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

function normalizeTagRuleValues(
  value: unknown,
  label: string,
): string | readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return normalizeEvalString(value, label);
  const normalized = normalizeEvalStringList(value, label);
  if (normalized.length === 0) {
    throw createEvalValidationError(`${label} must not be empty`);
  }
  return normalized;
}

function normalizeLiveEvalTagRules(
  rules: readonly LiveEvalCaseTagRule[],
): LiveEvalCaseTagRule[] {
  if (!Array.isArray(rules)) {
    throw createEvalValidationError("Live eval areaTagRules must be an array");
  }

  return rules.map((rule, index) => {
    if (!isEvalRecord(rule)) {
      throw createEvalValidationError(`Live eval areaTagRules[${index}] must be an object`);
    }
    const normalized: LiveEvalCaseTagRule = {
      tag: normalizeEvalString(rule.tag, `Live eval areaTagRules[${index}] tag`),
      ...(rule.equals !== undefined
        ? {
          equals: normalizeTagRuleValues(
            rule.equals,
            `Live eval areaTagRules[${index}] equals`,
          ),
        }
        : {}),
      ...(rule.startsWith !== undefined
        ? {
          startsWith: normalizeTagRuleValues(
            rule.startsWith,
            `Live eval areaTagRules[${index}] startsWith`,
          ),
        }
        : {}),
      ...(rule.includes !== undefined
        ? {
          includes: normalizeTagRuleValues(
            rule.includes,
            `Live eval areaTagRules[${index}] includes`,
          ),
        }
        : {}),
    };
    if (
      normalized.equals === undefined &&
      normalized.startsWith === undefined &&
      normalized.includes === undefined
    ) {
      throw createEvalValidationError(
        `Live eval areaTagRules[${index}] must define a matcher`,
      );
    }
    return normalized;
  });
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
  const caseId = normalizeEvalString(input.caseId, "Live eval case id");
  if (
    input.surface !== "read-only" &&
    input.surface !== "write" &&
    input.surface !== "experimental"
  ) {
    throw createEvalValidationError(`Unknown live eval case surface "${String(input.surface)}"`);
  }
  if (typeof input.requireProject !== "boolean") {
    throw createEvalValidationError("Live eval requireProject must be a boolean");
  }
  const optionalJudgeCasePrefixes = normalizeEvalStringList(
    input.optionalJudgeCasePrefixes ?? DEFAULT_LIVE_EVAL_OPTIONAL_JUDGE_CASE_PREFIXES,
    "Live eval optionalJudgeCasePrefixes",
  );
  const areaTagRules = normalizeLiveEvalTagRules(
    input.areaTagRules ?? DEFAULT_LIVE_EVAL_AREA_TAG_RULES,
  );
  const releaseGateCaseIds = new Set(
    normalizeEvalStringList(
      input.releaseGateCaseIds ? [...input.releaseGateCaseIds] : [],
      "Live eval releaseGateCaseIds",
    ),
  );
  const gradingTag = isOptionalJudgeCase(caseId, optionalJudgeCasePrefixes)
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

  if (caseIdCollectionHas(releaseGateCaseIds, caseId)) {
    tags.add("gate:release");
  }

  for (const tag of buildAreaTags(caseId, areaTagRules)) {
    tags.add(tag);
  }

  return {
    tags: [...tags].sort(compareStrings),
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
