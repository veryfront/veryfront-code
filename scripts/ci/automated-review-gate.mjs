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
  /(?:^|\r\n|[\r\n])([ \t]*(?:(?:>[ \t]*)|(?:#{1,6}[ \t]+)|(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*(?:Reviewing[ \t]+(?:files(?:[ \t]+that[ \t]+changed[ \t]+from[ \t]+the[ \t]+base[ \t]+of[ \t]+the[ \t]+PR)?|changed[ \t]+files(?:[ \t]+from[ \t]+the[ \t]+base[ \t]+of[ \t]+the[ \t]+PR)?)[ \t]+(?:and[ \t]+)?between))([^\r\n]*)/gi;
const CODERABBIT_REVIEW_RANGE_CONTINUATION_PREFIX_PATTERN =
  /^[ \t]*(?:(?:>[ \t]*)|(?:#{1,6}[ \t]+)|(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*/;
const CODERABBIT_REVIEW_RANGE_SEPARATOR_PATTERN =
  /(^|[ \t])and[ \t]+([0-9a-f]{40})(?![0-9a-f])/i;
const CODERABBIT_REVIEW_RANGE_WRAPPED_TIP_PATTERN =
  /^[ \t]*([0-9a-f]{40})(?![0-9a-f])/i;
const CODERABBIT_REVIEW_RANGE_WRAPPED_SEPARATOR_PATTERN =
  /^[ \t]*and[ \t]+([0-9a-f]{40})(?![0-9a-f])/i;
const FULL_COMMIT_TOKEN_PATTERN = /(^|[^0-9a-f])([0-9a-f]{40})(?![0-9a-f])/gi;
const MARKDOWN_FENCE_LINE_PATTERN =
  /^( {0,3}(?:(?:>[ \t]*)|(?:(?:[-*+]|\d{1,9}[.)])[ \t]+))*)(`{3,}|~{3,})/;
const MARKDOWN_HTML_COMMENT_BLOCK_START_PATTERN =
  /^( {0,3}(?:(?:>[ \t]*)|(?:(?:[-*+]|\d{1,9}[.)])[ \t]+))*)<!--/;
const MARKDOWN_LIST_PREFIX_PATTERN = /([-*+]|\d{1,9}[.)])([ \t]+)/g;
const MARKDOWN_PARAGRAPH_LIST_PREFIX_PATTERN = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const MARKDOWN_RAW_HTML_BLOCK_START_PATTERN =
  /^<(script|pre|style|textarea)(?:[ \t]|>|$)/i;
const MARKDOWN_PARAGRAPH_INTERRUPTING_HTML_TAG_PATTERN =
  /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?>|$)/i;
const MARKDOWN_PARAGRAPH_INTERRUPTING_RAW_HTML_PATTERN =
  /^ {0,3}<(?:script|pre|style|textarea)(?:[ \t]|>|$)/i;
const MARKDOWN_PARAGRAPH_INTERRUPTING_HTML_SYNTAX_PATTERN =
  /^ {0,3}(?:<!--|<\?|<![A-Za-z]|<!\[CDATA\[)/;
const MARKDOWN_FENCE_CONTAINER_CONTINUATION_PATTERN = /^[ \t]*(?:>[ \t]*)*/;
const CODERABBIT_REQUESTED_COMMIT_PATTERN =
  /Requested commit:[ \t]*([0-9a-f]{40})/gi;
const CODERABBIT_SKIPPED_COMMIT_PATTERN =
  /Review skipped for current commit[ \t]*([0-9a-f]{40})/gi;
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
  events.sort((left, right) => {
    if (left.time === undefined) {
      return right.time === undefined ? right.order - left.order : 1;
    }
    if (right.time === undefined) return -1;
    return right.time - left.time || right.order - left.order;
  });
  const timedEvents = Map.groupBy(
    events.filter((event) => event.time !== undefined),
    (event) => event.time,
  );
  for (const tiedEvents of timedEvents.values()) {
    const exactHeadOutcomes = (await Promise.all(
      tiedEvents.map(outcomeFor),
    )).filter(
      (outcome) => outcome.kind !== "not-head",
    );
    if (exactHeadOutcomes.length === 0) continue;
    if (
      exactHeadOutcomes.length > 1 &&
      exactHeadOutcomes.some((outcome) => outcome.kind !== "success")
    ) return { kind: "failure" };
    break;
  }

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
  const markdownStructure = scanMarkdownStructure(body);
  const selectedRecentReview = codeRabbitSelectedRecentReview(
    body,
    markdownStructure.reviewMarkers,
  );
  const currentHeadMarker = visibleMarkdownMatches(
    body,
    [
      CODERABBIT_SKIPPED_COMMIT_PATTERN,
      CODERABBIT_REQUESTED_COMMIT_PATTERN,
    ],
    markdownStructure.excludedRanges,
  ).some((match) => match[1]?.toLowerCase() === headSha.toLowerCase());
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

function codeRabbitSelectedRecentReview(body, reviewMarkers) {
  if (typeof body !== "string") return undefined;
  const groups = [];
  let openGroup;
  let previousFallbackContent;
  for (const marker of reviewMarkers) {
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

function visibleMarkdownMatches(content, patterns, excludedRanges) {
  const matches = patterns.flatMap((pattern) => [...content.matchAll(pattern)])
    .sort((left, right) => left.index - right.index);
  let excludedRangeIndex = 0;
  return matches.filter((match) => {
    while (
      excludedRangeIndex < excludedRanges.length &&
      excludedRanges[excludedRangeIndex][1] <= match.index
    ) {
      excludedRangeIndex += 1;
    }
    const range = excludedRanges[excludedRangeIndex];
    return !(range?.[0] <= match.index && match.index < range[1]);
  });
}

function scanMarkdownStructure(content) {
  const ranges = [];
  const reviewMarkers = [];
  const { inlineCodeRanges, inlineHtmlRanges } = markdownInlineStructureRanges(
    content,
  );
  let inlineCodeRangeIndex = 0;
  const isInsideInlineCode = (index) => {
    while (
      inlineCodeRanges[inlineCodeRangeIndex]?.[1] <= index
    ) {
      inlineCodeRangeIndex += 1;
    }
    const range = inlineCodeRanges[inlineCodeRangeIndex];
    return range?.[0] <= index && index < range[1];
  };
  let openFence;
  let openHtmlBlock;
  let openHtmlComment;
  let openParagraph;
  let lineStart = 0;
  for (const lineMatch of content.matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)) {
    const line = lineMatch[0];
    if (line.length === 0 && lineStart >= content.length) break;
    const lineEnd = lineStart + line.length;
    const lineWithoutEnding = line.replace(/(?:\r\n|[\r\n])$/, "");
    const paragraphLine = markdownParagraphLineContext(lineWithoutEnding);
    const continuesParagraph = markdownLineContinuesParagraph(
      paragraphLine,
      openParagraph,
    );
    const indentedCodeLine = isMarkdownIndentedCodeLine(lineWithoutEnding) &&
      !continuesParagraph;
    const paragraphAfterLine = markdownParagraphAfterLine(
      paragraphLine,
      openParagraph,
      continuesParagraph,
      indentedCodeLine,
    );

    if (openHtmlBlock !== undefined) {
      if (markdownHtmlBlockCloses(lineWithoutEnding, openHtmlBlock)) {
        ranges.push([openHtmlBlock.start, lineEnd]);
        openHtmlBlock = undefined;
        openParagraph = undefined;
        lineStart = lineEnd;
        continue;
      }
      if (
        !continuesMarkdownFenceContainer(
          lineWithoutEnding,
          openHtmlBlock.container,
        )
      ) {
        ranges.push([openHtmlBlock.start, lineStart]);
        openHtmlBlock = undefined;
      } else {
        openParagraph = undefined;
        lineStart = lineEnd;
        continue;
      }
    }

    if (
      openHtmlComment !== undefined &&
      openHtmlComment.container === undefined &&
      !continuesParagraph
    ) {
      openHtmlComment = undefined;
    }

    if (
      openHtmlComment?.container !== undefined &&
      !continuesMarkdownFenceContainer(
        lineWithoutEnding,
        openHtmlComment.container,
      )
    ) {
      ranges.push([openHtmlComment.start, lineStart]);
      openHtmlComment = undefined;
    }

    if (openHtmlComment !== undefined) {
      const inlineComment = openHtmlComment.container === undefined;
      const relativeCloseStart = lineWithoutEnding.indexOf("-->");
      if (relativeCloseStart < 0) {
        openParagraph = inlineComment ? paragraphAfterLine : undefined;
        lineStart = lineEnd;
        continue;
      }
      const closeStart = lineStart + relativeCloseStart;
      if (
        !inlineComment ||
        markdownInlineHtmlCommentHasValidEnd(content, closeStart)
      ) {
        ranges.push([openHtmlComment.start, closeStart + 3]);
      }
      openHtmlComment = scanMarkdownHtmlComments(
        content,
        lineWithoutEnding,
        lineStart,
        relativeCloseStart + 3,
        ranges,
        reviewMarkers,
        isInsideInlineCode,
        indentedCodeLine,
      );
      openParagraph = inlineComment && openHtmlComment?.container === undefined
        ? paragraphAfterLine
        : undefined;
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
      openParagraph = undefined;
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
        openParagraph = undefined;
        lineStart = lineEnd;
        continue;
      }
    }

    const htmlBlock = markdownHtmlBlockStart(
      lineWithoutEnding,
      indentedCodeLine,
    );
    if (htmlBlock !== undefined) {
      if (markdownHtmlBlockCloses(lineWithoutEnding, htmlBlock)) {
        ranges.push([lineStart, lineEnd]);
      } else {
        openHtmlBlock = {
          ...htmlBlock,
          start: lineStart,
        };
      }
      openParagraph = undefined;
      lineStart = lineEnd;
      continue;
    }

    openHtmlComment = scanMarkdownHtmlComments(
      content,
      lineWithoutEnding,
      lineStart,
      0,
      ranges,
      reviewMarkers,
      isInsideInlineCode,
      indentedCodeLine,
    );
    openParagraph = openHtmlComment?.container === undefined
      ? paragraphAfterLine
      : undefined;
    lineStart = lineEnd;
  }
  if (openHtmlBlock !== undefined) {
    ranges.push([openHtmlBlock.start, content.length]);
  } else if (openHtmlComment?.container !== undefined) {
    ranges.push([openHtmlComment.start, content.length]);
  } else if (openFence !== undefined) {
    ranges.push([openFence.start, content.length]);
  }
  const blockRanges = mergeMarkdownRanges(ranges, []);
  const refinedInlineRanges = blockRanges.length === 0
    ? { inlineCodeRanges, inlineHtmlRanges }
    : markdownInlineStructureRanges(content, blockRanges);
  return {
    excludedRanges: mergeMarkdownRanges(
      blockRanges,
      mergeMarkdownRanges(
        refinedInlineRanges.inlineCodeRanges,
        refinedInlineRanges.inlineHtmlRanges,
      ),
    ),
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

function isMarkdownIndentedCodeLine(line) {
  const prefix = line.match(
    MARKDOWN_FENCE_CONTAINER_CONTINUATION_PATTERN,
  )?.[0] ?? "";
  const firstBlockquote = prefix.indexOf(">");
  if (firstBlockquote < 0) return markdownColumns(prefix) >= 4;
  if (markdownColumns(prefix.slice(0, firstBlockquote)) >= 4) return true;
  return !hasValidMarkdownBlockquoteSpacing(prefix);
}

function markdownParagraphLineContext(line) {
  const containerPrefix = line.match(
    MARKDOWN_FENCE_CONTAINER_CONTINUATION_PATTERN,
  )?.[0] ?? "";
  const structuralPrefix = codeRabbitMarkdownPrefixSignature(containerPrefix);
  const indentation = markdownContainerIndentColumns(containerPrefix);
  const remainingLine = line.slice(containerPrefix.length);
  const listPrefix = remainingLine.match(
    MARKDOWN_PARAGRAPH_LIST_PREFIX_PATTERN,
  )?.[0];
  return {
    blockquoteDepth:
      [...containerPrefix].filter((character) => character === ">").length,
    content: listPrefix === undefined
      ? remainingLine
      : remainingLine.slice(listPrefix.length),
    indentation,
    listInterruptsParagraph: listPrefix === undefined
      ? false
      : markdownListMarkerInterruptsParagraph(listPrefix),
    listContinuationIndent: listPrefix === undefined
      ? undefined
      : markdownContainerIndentColumns(containerPrefix + listPrefix),
    structuralPrefix,
  };
}

function markdownLineContinuesParagraph(line, paragraph) {
  if (paragraph === undefined) return false;
  if (line.listContinuationIndent !== undefined) {
    if (line.listInterruptsParagraph) return false;
    if (
      paragraph.isListItem &&
      line.indentation < paragraph.continuationIndent
    ) return false;
  }
  const sameContainer = line.structuralPrefix === paragraph.structuralPrefix;
  const lazyBlockquoteContinuation = paragraph.blockquoteDepth > 0 &&
    line.blockquoteDepth < paragraph.blockquoteDepth;
  const lazyListContinuation = paragraph.isListItem;
  if (!sameContainer && !lazyBlockquoteContinuation) return false;
  if (
    line.indentation < paragraph.continuationIndent &&
    !lazyBlockquoteContinuation && !lazyListContinuation
  ) return false;
  if (line.listContinuationIndent !== undefined) return true;
  return line.indentation - paragraph.continuationIndent >= 4 ||
    isMarkdownNonInterruptingHtmlLine(line.content) ||
    !isMarkdownInlineCodeBarrier(line.content);
}

function markdownListMarkerInterruptsParagraph(listPrefix) {
  const marker = listPrefix.match(/^([-*+]|\d{1,9}[.)])/)?.[1];
  if (marker === undefined || /^[-*+]$/.test(marker)) return true;
  return Number(marker.slice(0, -1)) === 1;
}

function isMarkdownNonInterruptingHtmlLine(line) {
  // GitHub Flavored Markdown HTML block types 1–6 interrupt paragraphs;
  // type 7 does not.
  return /^ {0,3}<(?:[A-Za-z!?/])/.test(line) &&
    !MARKDOWN_PARAGRAPH_INTERRUPTING_HTML_TAG_PATTERN.test(line) &&
    !MARKDOWN_PARAGRAPH_INTERRUPTING_RAW_HTML_PATTERN.test(line) &&
    !MARKDOWN_PARAGRAPH_INTERRUPTING_HTML_SYNTAX_PATTERN.test(line);
}

function markdownParagraphAfterLine(
  line,
  openParagraph,
  continuesParagraph,
  indentedCodeLine,
) {
  if (continuesParagraph) return openParagraph;
  if (indentedCodeLine || isMarkdownInlineCodeBarrier(line.content)) {
    return undefined;
  }
  return {
    blockquoteDepth: line.blockquoteDepth,
    continuationIndent: line.listContinuationIndent ?? 0,
    isListItem: line.listContinuationIndent !== undefined,
    structuralPrefix: line.structuralPrefix,
  };
}

function markdownHtmlBlockStart(line, indentedCodeLine) {
  if (indentedCodeLine) return undefined;
  const containerPrefix = line.match(
    MARKDOWN_FENCE_CONTAINER_CONTINUATION_PATTERN,
  )?.[0] ?? "";
  if (!hasValidMarkdownBlockquoteSpacing(containerPrefix)) return undefined;
  const remainingLine = line.slice(containerPrefix.length);
  const listPrefix = remainingLine.match(
    MARKDOWN_PARAGRAPH_LIST_PREFIX_PATTERN,
  )?.[0] ?? "";
  const blockContent = remainingLine.slice(listPrefix.length);
  const tag = blockContent.match(
    MARKDOWN_RAW_HTML_BLOCK_START_PATTERN,
  )?.[1];
  if (tag !== undefined) {
    return {
      caseInsensitive: true,
      container: markdownFenceContainer(containerPrefix + listPrefix),
      terminator: `</${tag.toLowerCase()}>`,
    };
  }
  let terminator;
  if (blockContent.startsWith("<?")) terminator = "?>";
  else if (blockContent.startsWith("<![CDATA[")) terminator = "]]>";
  else if (/^<![A-Za-z]/.test(blockContent)) terminator = ">";
  if (terminator === undefined) return undefined;
  return {
    caseInsensitive: false,
    container: markdownFenceContainer(containerPrefix + listPrefix),
    terminator,
  };
}

function markdownHtmlBlockCloses(line, block) {
  const content = markdownContainerContent(line, block.container);
  if (content === undefined) return false;
  return (block.caseInsensitive ? content.toLowerCase() : content).includes(
    block.terminator,
  );
}

function markdownContainerContent(line, container) {
  let index = 0;
  while (line[index] === " " || line[index] === "\t") index += 1;
  for (let depth = 0; depth < container.blockquoteDepth; depth += 1) {
    if (line[index] !== ">") return undefined;
    index += 1;
    while (line[index] === " " || line[index] === "\t") index += 1;
  }
  const prefix = line.slice(0, index);
  if (
    !hasValidMarkdownBlockquoteSpacing(prefix) ||
    markdownContainerIndentColumns(prefix) < container.continuationIndent
  ) return undefined;
  return line.slice(index);
}

function scanMarkdownHtmlComments(
  content,
  line,
  lineStart,
  searchStart,
  ranges,
  reviewMarkers,
  isInsideInlineCode,
  indentedCodeLine,
) {
  while (searchStart < line.length) {
    const relativeCommentStart = line.indexOf("<!--", searchStart);
    if (relativeCommentStart < 0) return undefined;
    const commentStart = lineStart + relativeCommentStart;
    if (
      isInsideInlineCode(commentStart) ||
      isEscapedMarkdownToken(content, commentStart) ||
      indentedCodeLine
    ) {
      searchStart = relativeCommentStart + 4;
      continue;
    }
    const reviewMarker = codeRabbitReviewMarkerAt(line, relativeCommentStart);
    if (reviewMarker) {
      reviewMarkers.push({ value: reviewMarker, index: commentStart });
      searchStart = relativeCommentStart + reviewMarker.length;
      continue;
    }
    const shortCommentEnd = markdownShortHtmlCommentEnd(
      line,
      relativeCommentStart,
    );
    if (shortCommentEnd !== undefined) {
      ranges.push([commentStart, lineStart + shortCommentEnd]);
      searchStart = shortCommentEnd;
      continue;
    }
    const container = markdownHtmlCommentBlockContainer(
      line,
      relativeCommentStart,
    );
    const relativeCloseStart = line.indexOf("-->", relativeCommentStart + 4);
    if (relativeCloseStart < 0) {
      return {
        start: commentStart,
        container,
      };
    }
    if (
      container !== undefined ||
      markdownInlineHtmlCommentHasValidEnd(
        content,
        lineStart + relativeCloseStart,
      )
    ) {
      ranges.push([commentStart, lineStart + relativeCloseStart + 3]);
    }
    searchStart = relativeCloseStart + 3;
  }
  return undefined;
}

function markdownInlineHtmlCommentHasValidEnd(content, closeStart) {
  return content[closeStart - 1] !== "-";
}

function markdownHtmlCommentBlockContainer(line, commentStart) {
  const match = line.match(MARKDOWN_HTML_COMMENT_BLOCK_START_PATTERN);
  if (
    !match || match[1].length !== commentStart ||
    !hasValidMarkdownBlockquoteSpacing(match[1])
  ) return undefined;
  return markdownFenceContainer(match[1]);
}

function markdownInlineStructureRanges(content, excludedRanges = []) {
  const inlineCodeRanges = [];
  const inlineHtmlRanges = [];
  const excludedRangeCursor = { index: 0 };
  const lines = [];
  let nextLineStart = 0;
  for (const lineMatch of content.matchAll(/[^\r\n]*(?:\r\n|[\r\n]|$)/g)) {
    const line = lineMatch[0];
    if (line.length === 0 && nextLineStart >= content.length) break;
    const end = nextLineStart + line.length;
    lines.push({
      content: line.replace(/(?:\r\n|[\r\n])$/, ""),
      end,
      start: nextLineStart,
    });
    nextLineStart = end;
  }

  let segmentStart = 0;
  let openParagraph;
  let excludedRangeIndex = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineStart = line.start;
    const lineEnd = line.end;
    const lineWithoutEnding = line.content;
    const paragraphLine = markdownParagraphLineContext(lineWithoutEnding);
    const continuesParagraph = markdownLineContinuesParagraph(
      paragraphLine,
      openParagraph,
    );
    const indentedCodeLine = isMarkdownIndentedCodeLine(lineWithoutEnding) &&
      !continuesParagraph;
    while (excludedRanges[excludedRangeIndex]?.[1] <= lineStart) {
      excludedRangeIndex += 1;
    }
    const excludedRange = excludedRanges[excludedRangeIndex];
    const lineIsExcluded = excludedRange?.[0] <= lineStart &&
      lineStart < excludedRange[1];
    const referenceDefinitionLineCount = !continuesParagraph &&
        !indentedCodeLine && !lineIsExcluded
      ? markdownReferenceDefinitionLineCount(lines, lineIndex)
      : 0;
    if (referenceDefinitionLineCount > 0) {
      appendMarkdownInlineCodeRanges(
        content,
        segmentStart,
        lineStart,
        inlineCodeRanges,
        inlineHtmlRanges,
        excludedRanges,
        excludedRangeCursor,
      );
      const finalDefinitionLine = lines[
        lineIndex + referenceDefinitionLineCount - 1
      ];
      segmentStart = finalDefinitionLine.end;
      lineIndex += referenceDefinitionLineCount - 1;
      openParagraph = undefined;
      continue;
    }
    const paragraphAfterLine = markdownParagraphAfterLine(
      paragraphLine,
      openParagraph,
      continuesParagraph,
      indentedCodeLine,
    );
    const splitsInlineCode = indentedCodeLine ||
      (isMarkdownInlineCodeBarrier(lineWithoutEnding) && !continuesParagraph);
    if (splitsInlineCode) {
      appendMarkdownInlineCodeRanges(
        content,
        segmentStart,
        lineStart,
        inlineCodeRanges,
        inlineHtmlRanges,
        excludedRanges,
        excludedRangeCursor,
      );
      if (paragraphAfterLine !== undefined && !indentedCodeLine) {
        segmentStart = lineStart;
      } else {
        appendMarkdownInlineHtmlRanges(
          content,
          lineStart,
          lineEnd,
          inlineHtmlRanges,
        );
        segmentStart = lineEnd;
      }
    }
    openParagraph = paragraphAfterLine;
  }
  appendMarkdownInlineCodeRanges(
    content,
    segmentStart,
    content.length,
    inlineCodeRanges,
    inlineHtmlRanges,
    excludedRanges,
    excludedRangeCursor,
  );
  return { inlineCodeRanges, inlineHtmlRanges };
}

function isMarkdownInlineCodeBarrier(line) {
  if (
    line.trim().length === 0 ||
    /^ {0,3}<(?:[A-Za-z!?/])/.test(line) ||
    /^ {0,3}(?:>|#{1,6}(?:[ \t]|$)|(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$))/.test(
      line,
    ) ||
    /^ {0,3}(?:=+|-+)[ \t]*$/.test(line) ||
    /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(
      line,
    )
  ) return true;
  const fenceMatch = line.match(MARKDOWN_FENCE_LINE_PATTERN);
  return fenceMatch !== null &&
    hasValidMarkdownBlockquoteSpacing(fenceMatch[1]);
}

function markdownReferenceDefinitionLineCount(lines, lineIndex) {
  const firstLine = markdownParagraphLineContext(lines[lineIndex].content);
  let candidate = firstLine.content;
  let finalCandidateLine = lineIndex;
  while (candidate.length <= 2_048) {
    const parsed = markdownReferenceCandidate(candidate);
    const continuation = markdownReferenceContinuationLine(
      lines,
      finalCandidateLine + 1,
      firstLine,
    );
    if (
      parsed !== undefined &&
      (!parsed.acceptsTitleContinuation || continuation === undefined ||
        !markdownReferenceTitleStarts(continuation))
    ) return parsed.lineCount;
    if (continuation === undefined) return parsed?.lineCount ?? 0;
    candidate += `\n${continuation}`;
    finalCandidateLine += 1;
  }

  for (
    let index = finalCandidateLine + 1;
    index < lines.length;
    index += 1
  ) {
    const continuation = markdownReferenceContinuationLine(
      lines,
      index,
      firstLine,
    );
    if (continuation === undefined) break;
    candidate += `\n${continuation}`;
  }
  return markdownReferenceCandidate(candidate)?.lineCount ?? 0;
}

function markdownReferenceCandidate(candidate) {
  const labelEnd = markdownReferenceLabelEnd(candidate);
  if (labelEnd === undefined) return undefined;

  const beforeDestination = markdownReferenceWhitespaceEnd(candidate, labelEnd);
  const destinationEnd = markdownReferenceDestinationEnd(
    candidate,
    beforeDestination.end,
  );
  if (destinationEnd === undefined) return undefined;

  const destinationLineEnd = markdownReferenceLineEnd(
    candidate,
    destinationEnd,
  );
  const afterDestination = markdownReferenceWhitespaceEnd(
    candidate,
    destinationEnd,
  );
  if (afterDestination.end === candidate.length) {
    return {
      acceptsTitleContinuation: true,
      lineCount: markdownReferenceLineCount(candidate, destinationLineEnd),
    };
  }

  const titleStarts = candidate[afterDestination.end] === '"' ||
    candidate[afterDestination.end] === "'" ||
    candidate[afterDestination.end] === "(";
  if (titleStarts && afterDestination.end > destinationEnd) {
    const titleEnd = markdownReferenceTitleEnd(
      candidate,
      afterDestination.end,
    );
    if (titleEnd !== undefined) {
      const titleLineEnd = markdownReferenceLineEnd(candidate, titleEnd);
      if (/^[ \t]*$/.test(candidate.slice(titleEnd, titleLineEnd))) {
        return {
          acceptsTitleContinuation: false,
          lineCount: markdownReferenceLineCount(candidate, titleLineEnd),
        };
      }
    }
  }

  if (afterDestination.crossedLine) {
    return {
      acceptsTitleContinuation: false,
      lineCount: markdownReferenceLineCount(candidate, destinationLineEnd),
    };
  }
  return undefined;
}

function markdownReferenceTitleStarts(line) {
  const firstCharacter = line.trimStart()[0];
  return firstCharacter === '"' || firstCharacter === "'" ||
    firstCharacter === "(";
}

function markdownReferenceContinuationLine(lines, lineIndex, firstLine) {
  const line = lines[lineIndex];
  if (line === undefined || line.content.trim().length === 0) return undefined;
  const continuation = markdownParagraphLineContext(line.content);
  if (
    continuation.structuralPrefix !== firstLine.structuralPrefix ||
    continuation.listContinuationIndent !== undefined ||
    (firstLine.listContinuationIndent !== undefined &&
      continuation.indentation < firstLine.listContinuationIndent)
  ) return undefined;
  return continuation.content;
}

function markdownReferenceLabelEnd(candidate) {
  if (candidate[0] !== "[") return undefined;

  let index = 1;
  let labelLength = 0;
  let hasNonWhitespace = false;
  while (index < candidate.length && labelLength <= 999) {
    const character = candidate[index];
    if (character === "]") {
      return labelLength <= 999 && hasNonWhitespace &&
          candidate[index + 1] === ":"
        ? index + 2
        : undefined;
    }
    if (character === "[") return undefined;
    if (character === "\\" && index + 1 < candidate.length) index += 1;
    if (!/[ \t\n]/.test(candidate[index])) hasNonWhitespace = true;
    labelLength += 1;
    index += 1;
  }
  return undefined;
}

function markdownReferenceWhitespaceEnd(candidate, start) {
  let index = start;
  while (candidate[index] === " " || candidate[index] === "\t") index += 1;
  if (candidate[index] !== "\n") {
    return { crossedLine: false, end: index };
  }
  index += 1;
  while (candidate[index] === " " || candidate[index] === "\t") index += 1;
  return { crossedLine: true, end: index };
}

function markdownReferenceDestinationEnd(candidate, start) {
  if (candidate[start] === "<") {
    for (let index = start + 1; index < candidate.length; index += 1) {
      if (candidate[index] === "\\" && index + 1 < candidate.length) {
        index += 1;
        continue;
      }
      if (candidate[index] === "\n" || candidate[index] === "<") {
        return undefined;
      }
      if (candidate[index] === ">") return index + 1;
    }
    return undefined;
  }
  if (candidate[start] === undefined || candidate[start] === "<") {
    return undefined;
  }

  let parentheses = 0;
  let index = start;
  while (index < candidate.length && !/[ \t\n]/.test(candidate[index])) {
    const character = candidate[index];
    const characterCode = character.charCodeAt(0);
    if (characterCode <= 0x1f || characterCode === 0x7f) return undefined;
    if (character === "\\" && index + 1 < candidate.length) {
      index += 2;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") {
      if (parentheses === 0) return undefined;
      parentheses -= 1;
    }
    index += 1;
  }
  return index > start && parentheses === 0 ? index : undefined;
}

function markdownReferenceTitleEnd(line, start) {
  const opening = line[start];
  const closing = opening === "(" ? ")" : opening;
  if (opening !== '"' && opening !== "'" && opening !== "(") return undefined;
  for (let index = start + 1; index < line.length; index += 1) {
    if (line[index] === "\\" && index + 1 < line.length) {
      index += 1;
      continue;
    }
    if (line[index] === closing) {
      return index + 1;
    }
    if (opening === "(" && line[index] === "(") return undefined;
  }
  return undefined;
}

function markdownReferenceLineEnd(candidate, start) {
  const lineEnd = candidate.indexOf("\n", start);
  return lineEnd < 0 ? candidate.length : lineEnd;
}

function markdownReferenceLineCount(candidate, end) {
  let lineCount = 1;
  for (let index = 0; index < end; index += 1) {
    if (candidate[index] === "\n") lineCount += 1;
  }
  return lineCount;
}

function appendMarkdownInlineCodeRanges(
  content,
  start,
  end,
  inlineCodeRanges,
  inlineHtmlRanges,
  excludedRanges,
  excludedRangeCursor,
) {
  let segmentStart = start;
  let excludedIndex = excludedRangeCursor.index;
  while (excludedRanges[excludedIndex]?.[1] <= segmentStart) {
    excludedIndex += 1;
  }
  while (excludedIndex < excludedRanges.length) {
    const [excludedStart, excludedEnd] = excludedRanges[excludedIndex];
    if (excludedStart >= end) break;
    if (segmentStart < excludedStart) {
      appendMarkdownInlineCodeRangesInSegment(
        content,
        segmentStart,
        Math.min(excludedStart, end),
        inlineCodeRanges,
        inlineHtmlRanges,
      );
    }
    segmentStart = Math.max(segmentStart, excludedEnd);
    if (excludedEnd > end) {
      excludedRangeCursor.index = excludedIndex;
      return;
    }
    excludedIndex += 1;
    if (segmentStart >= end) {
      excludedRangeCursor.index = excludedIndex;
      return;
    }
  }
  excludedRangeCursor.index = excludedIndex;
  if (segmentStart < end) {
    appendMarkdownInlineCodeRangesInSegment(
      content,
      segmentStart,
      end,
      inlineCodeRanges,
      inlineHtmlRanges,
    );
  }
}

function appendMarkdownInlineCodeRangesInSegment(
  content,
  start,
  end,
  inlineCodeRanges,
  inlineHtmlRanges,
) {
  const delimiterRuns = [];
  for (let index = start; index < end;) {
    if (content[index] !== "`") {
      index += 1;
      continue;
    }
    let runEnd = index + 1;
    while (content[runEnd] === "`") runEnd += 1;
    delimiterRuns.push({
      escaped: isEscapedMarkdownToken(content, index),
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
    const openingLength = run.escaped ? run.length - 1 : run.length;
    if (openingLength > 0) {
      nextRunWithLength[index] = nextIndexByLength.get(openingLength);
    }
    nextIndexByLength.set(run.length, index);
  }

  const findHtmlTerminator = createMarkdownInlineTerminatorFinder(content, end);
  let delimiterIndex = 0;
  let cursor = start;
  while (cursor < end) {
    while (delimiterRuns[delimiterIndex]?.end <= cursor) {
      delimiterIndex += 1;
    }
    while (
      delimiterRuns[delimiterIndex]?.escaped &&
      delimiterRuns[delimiterIndex].length === 1
    ) {
      cursor = delimiterRuns[delimiterIndex].end;
      delimiterIndex += 1;
    }
    const delimiterRun = delimiterRuns[delimiterIndex];
    const delimiter = delimiterRun?.escaped
      ? {
        start: delimiterRun.start + 1,
        end: delimiterRun.end,
        length: delimiterRun.length - 1,
      }
      : delimiterRun;
    const htmlStart = content.indexOf("<", cursor);
    if (
      htmlStart >= 0 && htmlStart < end &&
      (delimiter === undefined || htmlStart < delimiter.start)
    ) {
      if (isEscapedMarkdownToken(content, htmlStart)) {
        cursor = htmlStart + 1;
        continue;
      }
      const htmlEnd = markdownInlineHtmlEnd(
        content,
        htmlStart,
        end,
        findHtmlTerminator,
      );
      cursor = htmlEnd ?? htmlStart + 1;
      if (htmlEnd !== undefined) {
        if (!content.startsWith("<!--", htmlStart)) {
          inlineHtmlRanges.push([htmlStart, htmlEnd]);
        }
        while (delimiterRuns[delimiterIndex]?.start < htmlEnd) {
          delimiterIndex += 1;
        }
      }
      continue;
    }
    if (delimiter === undefined) break;

    const closingIndex = nextRunWithLength[delimiterIndex];
    if (closingIndex === undefined) {
      cursor = delimiter.end;
      delimiterIndex += 1;
      continue;
    }
    inlineCodeRanges.push([
      delimiter.start,
      delimiterRuns[closingIndex].end,
    ]);
    cursor = delimiterRuns[closingIndex].end;
    delimiterIndex = closingIndex + 1;
  }
}

function appendMarkdownInlineHtmlRanges(content, start, end, ranges) {
  const findHtmlTerminator = createMarkdownInlineTerminatorFinder(content, end);
  let cursor = start;
  while (cursor < end) {
    const htmlStart = content.indexOf("<", cursor);
    if (htmlStart < 0 || htmlStart >= end) return;
    if (isEscapedMarkdownToken(content, htmlStart)) {
      cursor = htmlStart + 1;
      continue;
    }
    const htmlEnd = markdownInlineHtmlEnd(
      content,
      htmlStart,
      end,
      findHtmlTerminator,
    );
    if (htmlEnd === undefined) {
      cursor = htmlStart + 1;
      continue;
    }
    if (!content.startsWith("<!--", htmlStart)) {
      ranges.push([htmlStart, htmlEnd]);
    }
    cursor = htmlEnd;
  }
}

function createMarkdownInlineTerminatorFinder(content, end) {
  const nextIndexByTerminator = new Map();
  return (terminator, start) => {
    let nextIndex = nextIndexByTerminator.get(terminator);
    if (nextIndex === -1) return undefined;
    if (nextIndex === undefined || nextIndex < start) {
      nextIndex = content.indexOf(terminator, start);
      if (nextIndex < 0 || nextIndex >= end) {
        nextIndexByTerminator.set(terminator, -1);
        return undefined;
      }
      nextIndexByTerminator.set(terminator, nextIndex);
    }
    return nextIndex;
  };
}

function markdownInlineHtmlEnd(content, start, end, findTerminator) {
  if (content.startsWith("<!--", start)) {
    const shortCommentEnd = markdownShortHtmlCommentEnd(content, start);
    if (shortCommentEnd !== undefined && shortCommentEnd <= end) {
      return shortCommentEnd;
    }
    const closeStart = findTerminator("-->", start + 4);
    return closeStart === undefined ? undefined : closeStart + 3;
  }
  if (content.startsWith("<?", start)) {
    const closeStart = findTerminator("?>", start + 2);
    return closeStart === undefined ? undefined : closeStart + 2;
  }
  if (content.startsWith("<![CDATA[", start)) {
    const closeStart = findTerminator("]]>", start + 9);
    return closeStart === undefined ? undefined : closeStart + 3;
  }
  if (content.startsWith("<!", start) && isAsciiLetter(content[start + 2])) {
    const closeStart = findTerminator(">", start + 3);
    return closeStart === undefined ? undefined : closeStart + 1;
  }
  return markdownAngleAutolinkEnd(content, start, end) ??
    markdownInlineHtmlTagEnd(content, start, end, findTerminator);
}

function markdownAngleAutolinkEnd(content, start, end) {
  let index = start + 1;
  while (index < end) {
    const character = content[index];
    if (character === ">") {
      const destination = content.slice(start + 1, index);
      const uri = /^[A-Za-z][A-Za-z0-9.+-]{1,31}:[^\s<>]*$/.test(
        destination,
      );
      const email =
        /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/
          .test(
            destination,
          );
      return uri || email ? index + 1 : undefined;
    }
    const characterCode = character.charCodeAt(0);
    if (
      character === "<" || characterCode <= 0x20 || characterCode === 0x7f
    ) return undefined;
    index += 1;
  }
  return undefined;
}

function markdownShortHtmlCommentEnd(content, start) {
  if (content.startsWith("<!-->", start)) return start + 5;
  if (content.startsWith("<!--->", start)) return start + 6;
  return undefined;
}

function markdownInlineHtmlTagEnd(content, start, end, findTerminator) {
  let index = start + 1;
  const closingTag = content[index] === "/";
  if (closingTag) index += 1;
  if (!isAsciiLetter(content[index])) return undefined;
  index += 1;
  while (index < end && /[A-Za-z0-9-]/.test(content[index])) index += 1;

  if (closingTag) {
    while (index < end && isMarkdownWhitespace(content[index])) index += 1;
    return content[index] === ">" ? index + 1 : undefined;
  }

  while (index < end) {
    const whitespaceStart = index;
    while (index < end && isMarkdownWhitespace(content[index])) index += 1;
    if (content[index] === ">") return index + 1;
    if (content[index] === "/" && content[index + 1] === ">") {
      return index + 2;
    }
    if (
      index === whitespaceStart ||
      !/[A-Za-z_:]/.test(content[index])
    ) return undefined;

    index += 1;
    while (index < end && /[A-Za-z0-9_.:-]/.test(content[index])) index += 1;
    while (index < end && isMarkdownWhitespace(content[index])) index += 1;
    if (content[index] !== "=") continue;

    index += 1;
    while (index < end && isMarkdownWhitespace(content[index])) index += 1;
    const quote = content[index];
    if (quote === '"' || quote === "'") {
      const quoteEnd = findTerminator(quote, index + 1);
      if (quoteEnd === undefined) return undefined;
      index = quoteEnd + 1;
      continue;
    }
    const valueStart = index;
    while (
      index < end &&
      !isMarkdownWhitespace(content[index]) &&
      !/["'=<>`]/.test(content[index])
    ) index += 1;
    if (index === valueStart) return undefined;
  }
  return undefined;
}

function isAsciiLetter(value) {
  return typeof value === "string" && /[A-Za-z]/.test(value);
}

function isMarkdownWhitespace(value) {
  return value === " " || value === "\t" || value === "\n" ||
    value === "\r" || value === "\f";
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
    blockquoteDepth:
      [...prefix].filter((character) => character === ">").length,
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
