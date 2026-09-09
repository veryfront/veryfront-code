import { privateArtifactText as text } from "./private-artifact-text.ts";
import { joinPrivateArray } from "#veryfront/security/private-array.ts";
const RESEARCH_TASK_CUE_PATTERN = /\b(research|report|findings|sources|authoritative sources)\b/i;
const RESEARCH_PROJECT_SAVE_CUE_PATTERN =
  /\b(?:save|write|persist|store|compile)\b[^\n]{0,120}\b(?:to|into)\b[^\n]{0,40}\b(?:the\s+)?project\b/i;

const PROJECT_ARTIFACT_PATH_PATTERN = /(?:\/|\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[\w.-]+/g;

function slugifyArtifactSegment(value: string): string {
  const lower = text.toLowerCase(value);
  const unquoted = text.replace(lower, /['"]/g, "");
  const separated = text.replace(unquoted, /[^a-z0-9]+/g, "-");
  return text.replace(separated, /^-+|-+$/g, "");
}

function slugifyRunArtifactSegment(value: string): string {
  const separated = text.replace(text.toLowerCase(value), /[^a-z0-9_-]+/g, "-");
  return text.replace(separated, /^-+|-+$/g, "");
}

function hasAnyArtifactPath(prompt: string): boolean {
  return text.match(prompt, PROJECT_ARTIFACT_PATH_PATTERN) !== null;
}

function isGenericResearchTopic(value: string): boolean {
  const normalized = text.toLowerCase(text.trim(value));
  return normalized.length === 0 ||
    normalized === "this" || normalized === "that" || normalized === "it" ||
    normalized === "the project" || normalized === "the topic";
}

function extractResearchTopic(input: { description: string; prompt: string }): string | null {
  const quoted = text.match(input.prompt, /\bresearch(?:\s+on|\s+about)?\s+["“]([^"”]+)["”]/i)?.[1];
  if (quoted && text.trim(quoted) && !isGenericResearchTopic(quoted)) return text.trim(quoted);

  let cleaned = text.replace(input.description, /^research\s+/i, "");
  cleaned = text.replace(cleaned, /\.\s+.*$/s, "");
  cleaned = text.replace(cleaned, /\s+and\s+(?:save|write|persist|store|compile)\b.*$/i, "");
  cleaned = text.trim(text.replace(cleaned, /\s+across\b.*$/i, ""));
  if (cleaned.length > 0) return cleaned;

  let topic = text.match(input.prompt, /\bresearch(?:\s+on|\s+about)?\s+([^\n.,:]+)/i)?.[1];
  if (topic === undefined) return null;
  topic = text.replace(topic, /\s+and\s+save\b.*$/i, "");
  topic = text.trim(text.replace(topic, /\s+and\s+write\b.*$/i, ""));
  return !topic || isGenericResearchTopic(topic) ? null : topic;
}

/** Public API contract for default research artifact paths. */
export interface DefaultResearchArtifactPaths {
  topicSlug: string;
  topicRootPath: string;
  currentReportPath: string;
  runReportPath: string;
  findingsPath: string;
  sourcesPath: string;
}

/** Should inject default research artifact path helper. */
export function shouldInjectDefaultResearchArtifactPath(input: {
  description: string;
  prompt: string;
}): boolean {
  if (
    text.match(input.description, RESEARCH_TASK_CUE_PATTERN) === null &&
    text.match(input.prompt, RESEARCH_TASK_CUE_PATTERN) === null
  ) {
    return false;
  }

  if (text.match(input.prompt, RESEARCH_PROJECT_SAVE_CUE_PATTERN) === null) {
    return false;
  }

  return !hasAnyArtifactPath(input.prompt);
}

/** Builds default research artifact path reminder. */
export function buildDefaultResearchArtifactPathReminder(input: {
  description: string;
  prompt: string;
  runId?: string;
}): string | null {
  if (!shouldInjectDefaultResearchArtifactPath(input)) {
    return null;
  }

  const artifactPaths = buildDefaultResearchArtifactPaths(input);

  return joinPrivateArray([
    "Default research workspace (because no exact artifact path was provided):",
    `- Write the run-scoped report to exactly ${artifactPaths.runReportPath}.`,
    `- Then create or update the current topic report at exactly ${artifactPaths.currentReportPath}.`,
    `- Supporting artifacts can live at ${artifactPaths.findingsPath} and ${artifactPaths.sourcesPath} when useful.`,
    `CRITICAL: The task is incomplete until ${artifactPaths.runReportPath} and ${artifactPaths.currentReportPath} both exist with the final report content.`,
    "Use create_file or update_file yourself before finishing.",
  ], "\n");
}

/** Builds default research artifact paths. */
export function buildDefaultResearchArtifactPaths(input: {
  description: string;
  prompt: string;
  runId?: string;
}): DefaultResearchArtifactPaths {
  const topic = extractResearchTopic(input);
  const topicSlug = topic ? slugifyArtifactSegment(topic) : "research-report";
  const sanitizedRunId = slugifyRunArtifactSegment(input.runId ?? "");
  const effectiveRunId = sanitizedRunId.length > 0 ? sanitizedRunId : "latest";
  const topicRootPath = `/research/${topicSlug}`;

  return {
    topicSlug,
    topicRootPath,
    currentReportPath: `${topicRootPath}/report.md`,
    runReportPath: `${topicRootPath}/runs/${effectiveRunId}.report.md`,
    findingsPath: `${topicRootPath}/findings.md`,
    sourcesPath: `${topicRootPath}/sources.md`,
  };
}

export function buildDefaultResearchArtifactPathsFromCurrentReportPath(input: {
  currentReportPath: string;
  runId?: string;
}): DefaultResearchArtifactPaths | null {
  const currentReportPath = text.replace(input.currentReportPath, /^\/+/, "");
  const reportPathMatch = text.match(currentReportPath, /^research\/(.+)\/report\.md$/);
  if (!reportPathMatch?.[1]) {
    return null;
  }

  const topicSlug = reportPathMatch[1];
  const sanitizedRunId = slugifyRunArtifactSegment(input.runId ?? "");
  const effectiveRunId = sanitizedRunId.length > 0 ? sanitizedRunId : "latest";
  const topicRootPath = `/research/${topicSlug}`;

  return {
    topicSlug,
    topicRootPath,
    currentReportPath: `/${currentReportPath}`,
    runReportPath: `${topicRootPath}/runs/${effectiveRunId}.report.md`,
    findingsPath: `${topicRootPath}/findings.md`,
    sourcesPath: `${topicRootPath}/sources.md`,
  };
}

/** Applies default research artifact path. */
export function withDefaultResearchArtifactPath(input: {
  description: string;
  prompt: string;
  runId?: string;
}): string {
  const reminder = buildDefaultResearchArtifactPathReminder(input);
  if (!reminder) {
    return input.prompt;
  }

  return joinPrivateArray([input.prompt, "", reminder], "\n");
}
