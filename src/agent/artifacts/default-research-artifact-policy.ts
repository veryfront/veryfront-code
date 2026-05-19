const RESEARCH_TASK_CUE_PATTERN = /\b(research|report|findings|sources|authoritative sources)\b/i;
const RESEARCH_PROJECT_SAVE_CUE_PATTERN =
  /\b(?:save|write|persist|store|compile)\b[^\n]{0,120}\b(?:to|into)\b[^\n]{0,40}\b(?:the\s+)?project\b/i;

const PROJECT_ARTIFACT_PATH_PATTERN = /(?:\/|\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[\w.-]+/g;

function slugifyArtifactSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugifyRunArtifactSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hasAnyArtifactPath(prompt: string): boolean {
  PROJECT_ARTIFACT_PATH_PATTERN.lastIndex = 0;
  return PROJECT_ARTIFACT_PATH_PATTERN.test(prompt);
}

function isGenericResearchTopic(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ||
    normalized === "this" ||
    normalized === "that" ||
    normalized === "it" ||
    normalized === "the project" ||
    normalized === "the topic";
}

function extractResearchTopic(input: { description: string; prompt: string }): string | null {
  const quotedPromptTopic = input.prompt.match(/\bresearch(?:\s+on|\s+about)?\s+["“]([^"”]+)["”]/i)
    ?.[1];
  if (quotedPromptTopic?.trim() && !isGenericResearchTopic(quotedPromptTopic)) {
    return quotedPromptTopic.trim();
  }

  const cleanedDescription = input.description
    .replace(/^research\s+/i, "")
    .replace(/\.\s+.*$/s, "")
    .replace(/\s+and\s+(?:save|write|persist|store|compile)\b.*$/i, "")
    .replace(/\s+across\b.*$/i, "")
    .trim();
  if (cleanedDescription.length > 0) {
    return cleanedDescription;
  }

  const promptTopic = input.prompt
    .match(/\bresearch(?:\s+on|\s+about)?\s+([^\n.,:]+)/i)?.[1]
    ?.replace(/\s+and\s+save\b.*$/i, "")
    ?.replace(/\s+and\s+write\b.*$/i, "")
    ?.trim();
  if (!promptTopic || isGenericResearchTopic(promptTopic)) {
    return null;
  }

  return promptTopic;
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
    !RESEARCH_TASK_CUE_PATTERN.test(input.description) &&
    !RESEARCH_TASK_CUE_PATTERN.test(input.prompt)
  ) {
    return false;
  }

  if (!RESEARCH_PROJECT_SAVE_CUE_PATTERN.test(input.prompt)) {
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

  return [
    "Default research workspace (because no exact artifact path was provided):",
    `- Write the run-scoped report to exactly ${artifactPaths.runReportPath}.`,
    `- Then create or update the current topic report at exactly ${artifactPaths.currentReportPath}.`,
    `- Supporting artifacts can live at ${artifactPaths.findingsPath} and ${artifactPaths.sourcesPath} when useful.`,
    `CRITICAL: The task is incomplete until ${artifactPaths.runReportPath} and ${artifactPaths.currentReportPath} both exist with the final report content.`,
    "Use create_file or update_file yourself before finishing.",
  ].join("\n");
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
  const currentReportPath = input.currentReportPath.replace(/^\/+/, "");
  const reportPathMatch = currentReportPath.match(/^research\/(.+)\/report\.md$/);
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

  return [input.prompt, "", reminder].join("\n");
}
