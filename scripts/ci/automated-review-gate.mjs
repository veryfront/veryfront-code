const AUTOMATED_REVIEW_LOGINS = new Set([
  "coderabbitai[bot]",
  "chatgpt-codex-connector[bot]",
]);
const CODERABBIT_LOGIN = "coderabbitai[bot]";
const CODERABBIT_RECENT_REVIEW_MARKER = "<!-- recent_review_start -->";
const CODERABBIT_RECENT_REVIEW_END_MARKER = "<!-- recent_review_end -->";
const CODERABBIT_NO_ACTIONABLE_REVIEW_MARKER =
  "No actionable comments were generated in the recent review.";
const CODERABBIT_REVIEW_RANGE_PATTERN =
  /(?:^|\r\n|[\r\n])Reviewing files that changed from the base of the PR and between ([0-9a-f]{40}) and ([0-9a-f]{40})\.(?=\r\n|[\r\n]|$)/;
const CODERABBIT_REVIEW_RANGE_STATEMENT_START_PATTERN =
  /(?:^|\r\n|[\r\n])([ \t]*(?:(?:>[ \t]*)|(?:#{1,6}[ \t]+)|(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*(?:Reviewing[ \t]+(?:files(?:[ \t]+that[ \t]+changed[ \t]+from[ \t]+the[ \t]+base[ \t]+of[ \t]+the[ \t]+PR)?|changed[ \t]+files(?:[ \t]+from[ \t]+the[ \t]+base[ \t]+of[ \t]+the[ \t]+PR)?)[ \t]+(?:and[ \t]+)?between))([^\r\n]*)/gi;
const CODERABBIT_REVIEW_RANGE_CONTINUATION_PREFIX_PATTERN =
  /^[ \t]*(?:(?:>[ \t]*)|(?:#{1,6}[ \t]+)|(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*/;
const CODERABBIT_REVIEW_RANGE_SEPARATOR_PATTERN =
  /(^|[ \t])and[ \t]+([0-9a-f]{40})(?![0-9a-f])/i;
const CODERABBIT_REVIEW_RANGE_WRAPPED_TIP_PATTERN =
  /^[ \t]*([0-9a-f]{40})(?![0-9a-f])/i;
const CODERABBIT_REVIEW_RANGE_WRAPPED_SEPARATOR_PATTERN =
  /^[ \t]*and[ \t]+([0-9a-f]{40})(?![0-9a-f])/i;
const FULL_COMMIT_TOKEN_PATTERN = /(^|[^0-9a-f])([0-9a-f]{40})(?![0-9a-f])/gi;
const MARKDOWN_FENCE_LINE_PATTERN =
  /^( {0,3}(?:(?:>[ \t]*)|(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*)(`{3,}|~{3,})/;
const MARKDOWN_LIST_PREFIX_PATTERN =
  /([-*+]|\d+[.)])([ \t]+)(?:\[[ xX]\][ \t]+)?/g;
const MARKDOWN_FENCE_CONTAINER_CONTINUATION_PATTERN = /^[ \t]*(?:>[ \t]*)*/;
const CODERABBIT_REQUESTED_COMMIT_PATTERN =
  /Requested commit:\s*([0-9a-f]{40})/gi;
const CODERABBIT_SKIPPED_COMMIT_PATTERN =
  /Review skipped for current commit\s*([0-9a-f]{40})/gi;
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
const CODEX_BOT_ID = 199175422;
const CODEX_NO_FINDING_PREFIX = "Codex Review: Didn't find any major issues.";
const CODEX_REVIEWED_COMMIT_PATTERN =
  /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10})`/i;
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const WORKFLOW_COMMENT_LOGIN = "github-actions[bot]";
/** @type {(ref: string) => Promise<string | undefined>} */
const NO_COMMIT_RESOLVER = () => Promise.resolve(undefined);
export const AUTOMATED_REVIEW_STATUS_CONTEXT = "Automated review";
const SUBMITTED_REVIEW_STATES = new Set([
  "APPROVED",
  "COMMENTED",
]);

/** Decide the newest automated-review outcome for the current PR head. */
export async function findAutomatedReview(
  {
    reviews,
    comments,
    resolveCommit = NO_COMMIT_RESOLVER,
  },
  headSha,
) {
  const events = [
    ...reviews.map((review, index) => ({
      kind: "review",
      value: review,
      order: index,
      time: automatedReviewEventTime(review),
    })),
    ...comments.map((comment, index) => ({
      kind: "comment",
      value: comment,
      order: reviews.length + index,
      time: automatedReviewEventTime(comment),
    })),
  ];
  const outcomePromises = new Map();
  const outcomeFor = (event) => {
    let outcome = outcomePromises.get(event);
    if (!outcome) {
      outcome = classifyAutomatedReviewEvent(
        event,
        headSha,
        resolveCommit,
      );
      outcomePromises.set(event, outcome);
    }
    return outcome;
  };
  for (const event of events) {
    if (
      event.time === undefined &&
      (await outcomeFor(event)).kind !== "not-head"
    ) {
      return { kind: "failure" };
    }
  }
  const timedEvents = Map.groupBy(
    events.filter((event) => event.time !== undefined),
    (event) => event.time,
  );
  for (const tiedEvents of timedEvents.values()) {
    if (new Set(tiedEvents.map((event) => event.kind)).size < 2) continue;
    const exactHeadOutcomes = (await Promise.all(
      tiedEvents.map(outcomeFor),
    )).filter(
      (outcome) => outcome.kind !== "not-head",
    );
    if (
      exactHeadOutcomes.length > 1 &&
      exactHeadOutcomes.some((outcome) => outcome.kind !== "success")
    ) return { kind: "failure" };
  }
  events.sort((left, right) => {
    if (left.time === undefined) {
      return right.time === undefined ? right.order - left.order : 1;
    }
    if (right.time === undefined) return -1;
    return right.time - left.time || right.order - left.order;
  });

  for (const event of events) {
    const outcome = await outcomeFor(event);
    if (outcome.kind === "not-head") continue;
    return outcome;
  }
  return { kind: "waiting" };
}

function automatedReviewEventTime(value) {
  for (
    const timestamp of [
      value?.updated_at,
      value?.submitted_at,
      value?.created_at,
    ]
  ) {
    if (typeof timestamp !== "string") continue;
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function classifyAutomatedReviewEvent(
  event,
  headSha,
  resolveCommit,
) {
  if (event.kind === "review") {
    const review = event.value;
    const login = event.value?.user?.login;
    if (
      typeof login !== "string" ||
      !AUTOMATED_REVIEW_LOGINS.has(login.toLowerCase()) ||
      review?.commit_id !== headSha
    ) return { kind: "not-head" };
    const state = review?.state;
    if (typeof state !== "string") return { kind: "failure" };
    if (state.toUpperCase() === "PENDING") return { kind: "waiting" };
    if (
      typeof review?.submitted_at !== "string" ||
      review.submitted_at.length === 0
    ) return { kind: "failure" };
    if (!SUBMITTED_REVIEW_STATES.has(state.toUpperCase())) {
      return {
        kind: "failure",
        url: typeof review.html_url === "string" ? review.html_url : undefined,
      };
    }
    return {
      kind: "success",
      review: {
        reviewer: login,
        source: "review",
        state: state.toUpperCase(),
        url: typeof review.html_url === "string" ? review.html_url : undefined,
      },
    };
  }

  const comment = event.value;
  const login = comment?.user?.login;
  const body = comment?.body;
  if (typeof login !== "string" || typeof body !== "string") {
    return { kind: "not-head" };
  }
  if (
    login.toLowerCase() === CODEX_LOGIN &&
    comment?.user?.type === "Bot" &&
    comment?.user?.id === CODEX_BOT_ID
  ) {
    const reviewedCommit = body.match(CODEX_REVIEWED_COMMIT_PATTERN)?.[1];
    if (typeof reviewedCommit !== "string") return { kind: "not-head" };
    const resolvedCommit = await resolveCommit(reviewedCommit);
    if (
      typeof resolvedCommit !== "string" ||
      !FULL_COMMIT_PATTERN.test(resolvedCommit) ||
      resolvedCommit.toLowerCase() !== headSha.toLowerCase()
    ) return { kind: "not-head" };
    return body.startsWith(CODEX_NO_FINDING_PREFIX)
      ? {
        kind: "success",
        review: {
          reviewer: login,
          source: "summary",
          state: "COMMENTED",
          url: typeof comment.html_url === "string"
            ? comment.html_url
            : undefined,
        },
      }
      : {
        kind: "failure",
        url: typeof comment.html_url === "string"
          ? comment.html_url
          : undefined,
      };
  }
  if (login.toLowerCase() !== CODERABBIT_LOGIN) {
    return { kind: "not-head" };
  }
  const selectedRecentReview = codeRabbitSelectedRecentReview(body);
  const currentHeadMarker = [
    ...body.matchAll(CODERABBIT_SKIPPED_COMMIT_PATTERN),
    ...body.matchAll(CODERABBIT_REQUESTED_COMMIT_PATTERN),
  ].some((match) => match[1]?.toLowerCase() === headSha.toLowerCase());
  if (currentHeadMarker) {
    return {
      kind: "failure",
      url: typeof comment.html_url === "string" ? comment.html_url : undefined,
    };
  }
  const rangeEvidence = classifyCodeRabbitRangeEvidence(
    selectedRecentReview,
    headSha,
  );
  const effectiveRangeReview =
    rangeEvidence === "none" && selectedRecentReview?.fallbackContent
      ? {
        content: selectedRecentReview.fallbackContent,
        terminated: false,
      }
      : selectedRecentReview;
  const effectiveRangeEvidence = effectiveRangeReview === selectedRecentReview
    ? rangeEvidence
    : classifyCodeRabbitRangeEvidence(effectiveRangeReview, headSha);
  if (effectiveRangeEvidence === "current-invalid") {
    return {
      kind: "failure",
      url: typeof comment.html_url === "string" ? comment.html_url : undefined,
    };
  }
  if (effectiveRangeEvidence !== "current-valid") {
    return { kind: "not-head" };
  }
  if (!effectiveRangeReview?.terminated) {
    return {
      kind: "failure",
      url: typeof comment.html_url === "string" ? comment.html_url : undefined,
    };
  }
  return hasExactVisibleMarkdownLine(
      effectiveRangeReview.content,
      CODERABBIT_NO_ACTIONABLE_REVIEW_MARKER,
    )
    ? {
      kind: "success",
      review: {
        reviewer: login,
        source: "summary",
        state: "COMMENTED",
        url: typeof comment.html_url === "string"
          ? comment.html_url
          : undefined,
      },
    }
    : {
      kind: "failure",
      url: typeof comment.html_url === "string" ? comment.html_url : undefined,
    };
}

function codeRabbitSelectedRecentReview(body) {
  if (typeof body !== "string") return undefined;
  const groups = [];
  let openGroup;
  let previousFallbackContent;
  for (const marker of markdownReviewMarkers(body)) {
    if (marker.value === CODERABBIT_RECENT_REVIEW_MARKER) {
      if (openGroup) {
        openGroup.invalid = true;
      } else {
        openGroup = {
          contentStart: marker.index + CODERABBIT_RECENT_REVIEW_MARKER.length,
          invalid: false,
        };
      }
      continue;
    }
    if (!openGroup) continue;
    const content = body.slice(openGroup.contentStart, marker.index);
    const group = {
      content,
      terminated: !openGroup.invalid,
    };
    groups.push(group);
    previousFallbackContent = content;
    openGroup = undefined;
  }
  if (openGroup) {
    groups.push({
      content: body.slice(openGroup.contentStart),
      fallbackContent: previousFallbackContent,
      terminated: false,
    });
  }
  return groups.at(-1);
}

function classifyCodeRabbitRangeEvidence(selectedRecentReview, headSha) {
  if (!selectedRecentReview) return "none";
  const evidenceBlocks = codeRabbitRangeEvidenceStatements(
    selectedRecentReview.content,
  ).map((block) => parseCodeRabbitRangeEvidence(block, headSha)).filter((
    evidence,
  ) => evidence !== undefined);
  if (evidenceBlocks.length === 0) return "none";
  const currentEvidence = evidenceBlocks.filter((evidence) =>
    evidence.tipIsHead || evidence.extraHasHead
  );
  if (currentEvidence.length === 0) return "stale";
  if (
    currentEvidence.length === 1 && evidenceBlocks.length === 1 &&
    currentEvidence[0].isExactProduction && !currentEvidence[0].extraHasHead
  ) {
    return "current-valid";
  }
  return "current-invalid";
}

function codeRabbitRangeEvidenceStatements(content) {
  const excludedRanges = markdownExcludedRanges(content);
  const matches = [
    ...content.matchAll(CODERABBIT_REVIEW_RANGE_STATEMENT_START_PATTERN),
  ];
  const statementIndexes = matches.map(codeRabbitStatementIndex);
  const statements = [];
  let excludedRangeIndex = 0;
  for (const [matchIndex, match] of matches.entries()) {
    const statementIndex = statementIndexes[matchIndex];
    while (
      excludedRangeIndex < excludedRanges.length &&
      excludedRanges[excludedRangeIndex][1] <= statementIndex
    ) {
      excludedRangeIndex += 1;
    }
    const insideExcludedRange = excludedRangeIndex < excludedRanges.length &&
      excludedRanges[excludedRangeIndex][0] <= statementIndex &&
      statementIndex < excludedRanges[excludedRangeIndex][1];
    if (insideExcludedRange) continue;
    const continuationEnd = Math.min(
      statementIndexes[matchIndex + 1] ?? content.length,
      excludedRanges[excludedRangeIndex]?.[0] ?? content.length,
    );
    const statement = parseCodeRabbitRangeStatement(
      content,
      match,
      continuationEnd,
    );
    if (statement) statements.push(statement);
  }
  return statements;
}

function markdownExcludedRanges(content) {
  return scanMarkdownStructure(content).excludedRanges;
}

function hasExactVisibleMarkdownLine(content, expectedLine) {
  const excludedRanges = markdownExcludedRanges(content);
  let excludedRangeIndex = 0;
  let lineStart = 0;
  for (const lineMatch of content.matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)) {
    const line = lineMatch[0];
    if (line.length === 0 && lineStart >= content.length) break;
    const lineEnd = lineStart + line.length;
    const lineWithoutEnding = line.replace(/(?:\r\n|[\r\n])$/, "");
    while (
      excludedRangeIndex < excludedRanges.length &&
      excludedRanges[excludedRangeIndex][1] <= lineStart
    ) {
      excludedRangeIndex += 1;
    }
    const excludedRange = excludedRanges[excludedRangeIndex];
    const isExcluded = excludedRange?.[0] <= lineStart &&
      lineStart < excludedRange[1];
    if (!isExcluded && lineWithoutEnding === expectedLine) return true;
    lineStart = lineEnd;
  }
  return false;
}

function markdownReviewMarkers(content) {
  return scanMarkdownStructure(content).reviewMarkers;
}

function scanMarkdownStructure(content) {
  const ranges = [];
  const reviewMarkers = [];
  const inlineCodeRanges = markdownInlineCodeRanges(content);
  const possibleInlineCodeRanges = [];
  appendMarkdownInlineCodeRanges(
    content,
    0,
    content.length,
    possibleInlineCodeRanges,
  );
  let possibleInlineCodeRangeIndex = 0;
  const isInsidePossibleInlineCode = (index) => {
    while (
      possibleInlineCodeRanges[possibleInlineCodeRangeIndex]?.[1] <= index
    ) {
      possibleInlineCodeRangeIndex += 1;
    }
    const range = possibleInlineCodeRanges[possibleInlineCodeRangeIndex];
    return range?.[0] <= index && index < range[1];
  };
  let openFence;
  let openHtmlCommentStart;
  let lineStart = 0;
  for (const lineMatch of content.matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)) {
    const line = lineMatch[0];
    if (line.length === 0 && lineStart >= content.length) break;
    const lineEnd = lineStart + line.length;
    const lineWithoutEnding = line.replace(/(?:\r\n|[\r\n])$/, "");

    if (openHtmlCommentStart !== undefined) {
      const relativeCloseStart = lineWithoutEnding.indexOf("-->");
      if (relativeCloseStart < 0) {
        lineStart = lineEnd;
        continue;
      }
      const closeStart = lineStart + relativeCloseStart;
      ranges.push([openHtmlCommentStart, closeStart + 3]);
      openHtmlCommentStart = scanMarkdownHtmlComments(
        content,
        lineWithoutEnding,
        lineStart,
        relativeCloseStart + 3,
        ranges,
        reviewMarkers,
        isInsidePossibleInlineCode,
      );
      lineStart = lineEnd;
      continue;
    }

    if (
      openFence !== undefined &&
      !continuesMarkdownFenceContainer(lineWithoutEnding, openFence.container)
    ) {
      ranges.push([openFence.start, lineStart]);
      openFence = undefined;
    }

    if (openFence !== undefined) {
      const closingMarker = markdownClosingFenceMarker(
        lineWithoutEnding,
        openFence,
      );
      if (closingMarker) {
        ranges.push([openFence.start, lineEnd]);
        openFence = undefined;
      }
      lineStart = lineEnd;
      continue;
    }

    const fenceMatch = line.match(MARKDOWN_FENCE_LINE_PATTERN);
    if (fenceMatch && hasValidMarkdownBlockquoteSpacing(fenceMatch[1])) {
      const marker = fenceMatch[2];
      const markerEnd = lineWithoutEnding.indexOf(marker) + marker.length;
      const hasValidInfoString = marker[0] === "~" ||
        !lineWithoutEnding.slice(markerEnd).includes("`");
      if (hasValidInfoString) {
        openFence = {
          char: marker[0],
          length: marker.length,
          start: lineStart,
          container: markdownFenceContainer(fenceMatch[1]),
        };
        lineStart = lineEnd;
        continue;
      }
    }

    openHtmlCommentStart = scanMarkdownHtmlComments(
      content,
      lineWithoutEnding,
      lineStart,
      0,
      ranges,
      reviewMarkers,
      isInsidePossibleInlineCode,
    );
    lineStart = lineEnd;
  }
  if (openHtmlCommentStart !== undefined) {
    ranges.push([openHtmlCommentStart, content.length]);
  } else if (openFence !== undefined) {
    ranges.push([openFence.start, content.length]);
  }
  return {
    excludedRanges: mergeMarkdownRanges(ranges, inlineCodeRanges),
    reviewMarkers,
  };
}

function mergeMarkdownRanges(left, right) {
  const merged = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    const next = rightIndex >= right.length ||
        (leftIndex < left.length &&
          left[leftIndex][0] <= right[rightIndex][0])
      ? left[leftIndex++]
      : right[rightIndex++];
    const previous = merged.at(-1);
    if (previous && next[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], next[1]);
    } else {
      merged.push([...next]);
    }
  }
  return merged;
}

function hasValidMarkdownBlockquoteSpacing(prefix) {
  let column = 0;
  for (let index = 0; index < prefix.length;) {
    const character = prefix[index];
    column += character === "\t" ? 4 - (column % 4) : 1;
    index += 1;
    if (character !== ">") continue;

    const contentColumn = column;
    while (prefix[index] === " " || prefix[index] === "\t") {
      column += prefix[index] === "\t" ? 4 - (column % 4) : 1;
      index += 1;
    }
    if (column - contentColumn > 4) return false;
  }
  return true;
}

function scanMarkdownHtmlComments(
  content,
  line,
  lineStart,
  searchStart,
  ranges,
  reviewMarkers,
  isInsidePossibleInlineCode,
) {
  while (searchStart < line.length) {
    const relativeCommentStart = line.indexOf("<!--", searchStart);
    if (relativeCommentStart < 0) return undefined;
    const commentStart = lineStart + relativeCommentStart;
    const reviewMarker = codeRabbitReviewMarkerAt(line, relativeCommentStart);
    if (reviewMarker) {
      reviewMarkers.push({ value: reviewMarker, index: commentStart });
      searchStart = relativeCommentStart + reviewMarker.length;
      continue;
    }
    if (
      isInsidePossibleInlineCode(commentStart) ||
      isEscapedMarkdownToken(content, commentStart)
    ) {
      searchStart = relativeCommentStart + 4;
      continue;
    }
    const relativeCloseStart = line.indexOf("-->", relativeCommentStart + 4);
    if (relativeCloseStart < 0) return commentStart;
    ranges.push([commentStart, lineStart + relativeCloseStart + 3]);
    searchStart = relativeCloseStart + 3;
  }
  return undefined;
}

function markdownInlineCodeRanges(content) {
  const ranges = [];
  let segmentStart = 0;
  let lineStart = 0;
  for (const lineMatch of content.matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)) {
    const line = lineMatch[0];
    if (line.length === 0 && lineStart >= content.length) break;
    const lineEnd = lineStart + line.length;
    const lineWithoutEnding = line.replace(/(?:\r\n|[\r\n])$/, "");
    if (isMarkdownInlineCodeBarrier(lineWithoutEnding)) {
      appendMarkdownInlineCodeRanges(content, segmentStart, lineStart, ranges);
      segmentStart = lineEnd;
    }
    lineStart = lineEnd;
  }
  appendMarkdownInlineCodeRanges(content, segmentStart, content.length, ranges);
  return ranges;
}

function isMarkdownInlineCodeBarrier(line) {
  if (
    line.trim().length === 0 ||
    /^ {0,3}<(?:[A-Za-z!?/])/.test(line) ||
    /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|(?:[-+*]|\d+[.)])(?:[ \t]|$))/.test(
      line,
    ) ||
    /^ {0,3}=+[ \t]*$/.test(line) ||
    /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(
      line,
    )
  ) return true;
  const fenceMatch = line.match(MARKDOWN_FENCE_LINE_PATTERN);
  return fenceMatch !== null &&
    hasValidMarkdownBlockquoteSpacing(fenceMatch[1]);
}

function appendMarkdownInlineCodeRanges(content, start, end, ranges) {
  const delimiterRuns = [];
  for (let index = start; index < end;) {
    if (content[index] !== "`") {
      index += 1;
      continue;
    }
    if (isEscapedMarkdownToken(content, index)) {
      index += 1;
      continue;
    }
    let runEnd = index + 1;
    while (content[runEnd] === "`") runEnd += 1;
    delimiterRuns.push({
      start: index,
      end: runEnd,
      length: runEnd - index,
    });
    index = runEnd;
  }

  const nextRunWithLength = new Array(delimiterRuns.length);
  const nextIndexByLength = new Map();
  for (let index = delimiterRuns.length - 1; index >= 0; index -= 1) {
    const run = delimiterRuns[index];
    nextRunWithLength[index] = nextIndexByLength.get(run.length);
    nextIndexByLength.set(run.length, index);
  }

  for (let index = 0; index < delimiterRuns.length;) {
    const closingIndex = nextRunWithLength[index];
    if (closingIndex === undefined) {
      index += 1;
      continue;
    }
    ranges.push([
      delimiterRuns[index].start,
      delimiterRuns[closingIndex].end,
    ]);
    index = closingIndex + 1;
  }
}

function codeRabbitReviewMarkerAt(line, markerStart) {
  if (markerStart > 3) return undefined;
  const prefix = line.slice(0, markerStart);
  if (prefix.trim().length > 0 || markdownColumns(prefix) > 3) {
    return undefined;
  }
  for (
    const marker of [
      CODERABBIT_RECENT_REVIEW_MARKER,
      CODERABBIT_RECENT_REVIEW_END_MARKER,
    ]
  ) {
    if (
      line.startsWith(marker, markerStart) &&
      line.slice(markerStart + marker.length).trim().length === 0
    ) return marker;
  }
  return undefined;
}

function isEscapedMarkdownToken(content, tokenStart) {
  let slashStart = tokenStart;
  while (slashStart > 0 && content[slashStart - 1] === "\\") {
    slashStart -= 1;
  }
  return (tokenStart - slashStart) % 2 === 1;
}

function codeRabbitStatementIndex(match) {
  return match.index + match[0].indexOf(match[1]);
}

function parseCodeRabbitRangeStatement(content, match, continuationEnd) {
  const statementStart = match[1];
  const firstLineTail = match[2];
  const statementPrefix = codeRabbitMarkdownPrefixSignature(
    statementStart.slice(
      0,
      statementStart.toLowerCase().lastIndexOf("reviewing"),
    ),
  );
  const sameLineSeparator = firstLineTail.match(
    CODERABBIT_REVIEW_RANGE_SEPARATOR_PATTERN,
  );
  if (sameLineSeparator) {
    return {
      baseSegment: firstLineTail.slice(0, sameLineSeparator.index).trim()
        .toLowerCase(),
      statement: statementStart + firstLineTail,
      tipToken: sameLineSeparator[2].toLowerCase(),
      trailingStatement: firstLineTail.slice(
        sameLineSeparator.index + sameLineSeparator[0].length,
      ),
    };
  }

  const baseLines = [firstLineTail];
  const statementParts = [statementStart + firstLineTail];
  let lineEnd = match.index + match[0].length;
  while (true) {
    const nextLine = codeRabbitNextLine(content, lineEnd, continuationEnd);
    if (!nextLine) return undefined;
    const continuationPrefix = nextLine.content.match(
      CODERABBIT_REVIEW_RANGE_CONTINUATION_PREFIX_PATTERN,
    )?.[0] ?? "";
    const continuationContent = nextLine.content.slice(
      continuationPrefix.length,
    );
    if (
      continuationContent.trim().length === 0 ||
      continuationContent.trimStart().startsWith("<!--") ||
      codeRabbitMarkdownPrefixSignature(continuationPrefix) !== statementPrefix
    ) return undefined;
    statementParts.push(nextLine.separator, nextLine.content);

    const previousLine = baseLines.at(-1);
    const trailingAnd = previousLine?.match(/(^|[ \t])and[ \t]*$/i);
    const wrappedTip = continuationContent.match(
      CODERABBIT_REVIEW_RANGE_WRAPPED_TIP_PATTERN,
    );
    if (trailingAnd && wrappedTip) {
      return {
        baseSegment: codeRabbitBaseSegment(
          baseLines.slice(0, -1),
          previousLine.slice(0, trailingAnd.index),
        ),
        statement: statementParts.join(""),
        tipToken: wrappedTip[1].toLowerCase(),
        trailingStatement: continuationContent.slice(wrappedTip[0].length),
      };
    }

    const wrappedSeparator = continuationContent.match(
      CODERABBIT_REVIEW_RANGE_WRAPPED_SEPARATOR_PATTERN,
    );
    if (wrappedSeparator) {
      return {
        baseSegment: codeRabbitBaseSegment(
          baseLines,
          continuationContent.slice(0, wrappedSeparator.index),
        ),
        statement: statementParts.join(""),
        tipToken: wrappedSeparator[1].toLowerCase(),
        trailingStatement: continuationContent.slice(
          wrappedSeparator[0].length,
        ),
      };
    }

    baseLines.push(continuationContent);
    lineEnd = nextLine.lineEnd;
  }
}

function codeRabbitMarkdownPrefixSignature(prefix) {
  return prefix.trim().toLowerCase().replace(/[ \t]+/g, " ");
}

function codeRabbitBaseSegment(lines, finalLine) {
  return [...lines, finalLine].join("\n").trim().toLowerCase();
}

function codeRabbitNextLine(content, lineEnd, continuationEnd) {
  const separator = content.startsWith("\r\n", lineEnd)
    ? "\r\n"
    : content.startsWith("\n", lineEnd)
    ? "\n"
    : content.startsWith("\r", lineEnd)
    ? "\r"
    : undefined;
  if (!separator) return undefined;
  const contentStart = lineEnd + separator.length;
  if (contentStart >= continuationEnd) return undefined;
  const carriageReturn = content.indexOf("\r", contentStart);
  const lineFeed = content.indexOf("\n", contentStart);
  const nextLineEnd = carriageReturn < 0
    ? lineFeed
    : lineFeed < 0
    ? carriageReturn
    : Math.min(carriageReturn, lineFeed);
  return {
    content: content.slice(
      contentStart,
      nextLineEnd < 0 ? content.length : nextLineEnd,
    ),
    lineEnd: nextLineEnd < 0 ? content.length : nextLineEnd,
    separator,
  };
}

function markdownFenceContainer(prefix) {
  const listPrefixes = [...prefix.matchAll(MARKDOWN_LIST_PREFIX_PATTERN)];
  return {
    structuralPrefix: codeRabbitMarkdownPrefixSignature(
      prefix.replace(MARKDOWN_LIST_PREFIX_PATTERN, ""),
    ),
    continuationIndent: listPrefixes.length === 0
      ? 0
      : markdownContainerIndentColumns(prefix),
  };
}

function markdownContainerIndentColumns(prefix) {
  const structuralEnd = prefix.lastIndexOf(">") + 1;
  const structuralColumns = markdownColumns(prefix.slice(0, structuralEnd));
  return markdownColumns(prefix.slice(structuralEnd), structuralColumns) -
    structuralColumns;
}

function markdownColumns(value, initialColumn = 0) {
  let column = initialColumn;
  for (const character of value) {
    column += character === "\t" ? 4 - (column % 4) : 1;
  }
  return column;
}

function markdownClosingFenceMarker(line, fence) {
  const linePrefix = line.match(
    MARKDOWN_FENCE_CONTAINER_CONTINUATION_PATTERN,
  )?.[0] ?? "";
  if (
    codeRabbitMarkdownPrefixSignature(linePrefix) !==
      fence.container.structuralPrefix
  ) return undefined;
  const indentation = markdownContainerIndentColumns(linePrefix);
  if (
    indentation < fence.container.continuationIndent ||
    indentation > fence.container.continuationIndent + 3
  ) return undefined;
  const marker = line.slice(linePrefix.length).match(
    /^(`{3,}|~{3,})[ \t]*$/,
  )?.[1];
  return marker?.[0] === fence.char && marker.length >= fence.length
    ? marker
    : undefined;
}

function continuesMarkdownFenceContainer(line, container) {
  if (
    container.structuralPrefix.length === 0 &&
    container.continuationIndent === 0
  ) return true;
  const linePrefix = line.match(
    MARKDOWN_FENCE_CONTAINER_CONTINUATION_PATTERN,
  )?.[0] ?? "";
  if (
    codeRabbitMarkdownPrefixSignature(linePrefix) !==
      container.structuralPrefix
  ) return false;
  if (linePrefix.length === line.length) return true;
  return markdownContainerIndentColumns(linePrefix) >=
    container.continuationIndent;
}

function parseCodeRabbitRangeEvidence(evidence, headSha) {
  const normalizedHeadSha = headSha.toLowerCase();
  const extraTokens = [
    ...evidence.trailingStatement.matchAll(FULL_COMMIT_TOKEN_PATTERN),
  ].map((match) => match[2].toLowerCase());
  const exactMatch = evidence.statement.match(CODERABBIT_REVIEW_RANGE_PATTERN);
  return {
    tipIsHead: evidence.tipToken === normalizedHeadSha,
    extraHasHead: extraTokens.includes(normalizedHeadSha),
    isExactProduction:
      exactMatch?.[1]?.toLowerCase() === evidence.baseSegment &&
      exactMatch?.[2]?.toLowerCase() === evidence.tipToken &&
      FULL_COMMIT_PATTERN.test(evidence.baseSegment) &&
      extraTokens.length === 0,
  };
}

/** Publish the current automated-review decision on the exact PR head SHA. */
export async function publishAutomatedReviewStatus({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
  pullUrl,
  isDraft = false,
}) {
  // Review bots skip drafts, so a draft has no verdict yet. Publish pending so
  // "not reviewed yet" never renders as a pass and never as a missing status.
  if (isDraft) {
    const description = "Draft pull request waits for ready for review";
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: headSha,
      state: "pending",
      context: AUTOMATED_REVIEW_STATUS_CONTEXT,
      description,
      target_url: pullUrl,
    });
    return {
      state: "pending",
      review: undefined,
      failure: undefined,
      description,
    };
  }

  let decision = { kind: "waiting" };
  let failure;
  try {
    const reviews = await github.paginate(github.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    });
    decision = await findAutomatedReview({
      reviews,
      comments,
      resolveCommit: async (ref) => {
        const response = await github.rest.repos.getCommit({
          owner,
          repo,
          ref,
        });
        const sha = response?.data?.sha;
        if (typeof sha !== "string" || !FULL_COMMIT_PATTERN.test(sha)) {
          throw new Error("Commit lookup returned a malformed commit SHA");
        }
        return sha;
      },
    }, headSha);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  // No review for the current head is the normal state right after a push,
  // while the review bots are still working. Publish pending only for that
  // absent-or-waiting decision. Completed negative evidence and errors while
  // computing the decision stay failures so they are looked at, not waited out.
  if (decision.kind === "failure" && !failure) {
    failure = new Error("Automated review reported a negative outcome");
  }
  const review = decision.kind === "success" ? decision.review : undefined;
  const state = review ? "success" : failure ? "failure" : "pending";
  const description = review
    ? `Reviewed by ${review.reviewer}`
    : decision.kind === "failure"
    ? "Automated review did not pass the current commit"
    : failure
    ? "Could not determine the automated review status"
    : `Waiting for an automated review of ${headSha.slice(0, 12)}`;
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state,
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description,
    target_url: review?.url ?? decision.url ?? pullUrl,
  });
  return { state, review, failure, description };
}

/**
 * Ask Codex to review the current head commit, at most once per commit.
 *
 * The Codex connector reviews a pull request when it opens or leaves draft,
 * but a push to an open pull request does not trigger a new review. Posting
 * the literal "@codex review" comment is how a new review is requested. The
 * marker comment keeps the request idempotent: a rerun for the same head
 * finds the marker in an existing comment and does not post again, while a
 * new head carries a new marker and gets its own request.
 *
 * Only marker comments authored by the workflow itself count. A pull request
 * participant can paste the marker text into their own comment, and letting
 * that suppress the request would let anyone silence the review nudge for a
 * head commit.
 *
 * Immediately before posting, re-fetch the pull request and require its
 * current head to match the event head. That prevents a queued synchronize
 * run from marking an old SHA while its unqualified request targets a newer
 * current head.
 */
export async function requestAutomatedReview({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
}) {
  // The comment body must stay a fixed instruction plus a verified commit
  // SHA. Never interpolate pull request controlled content here: this runs
  // with pull_request_target authority.
  if (typeof headSha !== "string" || !FULL_COMMIT_PATTERN.test(headSha)) {
    throw new Error(
      "Refusing to request an automated review of a malformed head commit",
    );
  }
  const marker = `<!-- automated-review-request: ${headSha.toLowerCase()} -->`;
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100,
  });
  const alreadyRequested = comments.some((comment) =>
    comment?.user?.login === WORKFLOW_COMMENT_LOGIN &&
    comment?.user?.type === "Bot" &&
    typeof comment?.body === "string" &&
    comment.body.includes(marker)
  );
  if (alreadyRequested) {
    return { requested: false, marker };
  }
  const response = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });
  const currentHeadSha = response?.data?.head?.sha;
  if (
    typeof currentHeadSha !== "string" ||
    !FULL_COMMIT_PATTERN.test(currentHeadSha)
  ) {
    throw new Error("Could not verify the current pull request head commit");
  }
  if (currentHeadSha.toLowerCase() !== headSha.toLowerCase()) {
    return { requested: false, marker, reason: "stale-head" };
  }
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body: `${marker}\n@codex review`,
  });
  return { requested: true, marker };
}
