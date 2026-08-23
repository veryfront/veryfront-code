const AUTOMATED_REVIEW_LOGINS = new Set([
  "coderabbitai[bot]",
  "chatgpt-codex-connector[bot]",
]);
const CODERABBIT_LOGIN = "coderabbitai[bot]";
const CODERABBIT_RECENT_REVIEW_MARKER = "<!-- recent_review_start -->";
const CODERABBIT_RECENT_REVIEW_MARKER_PATTERN =
  /<!-- recent_review_start -->|<!-- recent_review_end -->/g;
const CODERABBIT_NO_ACTIONABLE_REVIEW_MARKER =
  "No actionable comments were generated in the recent review.";
const CODERABBIT_REVIEW_RANGE_PATTERN =
  /(?:^|\r?\n)Reviewing files that changed from the base of the PR and between ([0-9a-f]{40}) and ([0-9a-f]{40})\.(?=\r?\n|$)/;
const CODERABBIT_REVIEW_RANGE_STATEMENT_START_PATTERN =
  /(?:^|\r?\n)([ \t]*(?:(?:>[ \t]*)|(?:#{1,6}[ \t]+)|(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*(?:Reviewing[ \t]+(?:files(?:[ \t]+that[ \t]+changed[ \t]+from[ \t]+the[ \t]+base[ \t]+of[ \t]+the[ \t]+PR)?|changed[ \t]+files(?:[ \t]+from[ \t]+the[ \t]+base[ \t]+of[ \t]+the[ \t]+PR)?)[ \t]+(?:and[ \t]+)?between))([^\r\n]*)/gi;
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
  /^([ \t]{0,3}(?:(?:>[ \t]*)|(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*)(`{3,}|~{3,})/;
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
  return effectiveRangeReview?.content.includes(
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
  for (
    const marker of body.matchAll(CODERABBIT_RECENT_REVIEW_MARKER_PATTERN)
  ) {
    if (marker[0] === CODERABBIT_RECENT_REVIEW_MARKER) {
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
  const fenceRanges = markdownFenceRanges(content);
  return mergeMarkdownRanges(
    fenceRanges,
    markdownHtmlCommentRanges(content, fenceRanges),
  );
}

function markdownHtmlCommentRanges(content, fenceRanges) {
  const ranges = [];
  let fenceIndex = 0;
  let searchStart = 0;
  while (searchStart < content.length) {
    const commentStart = content.indexOf("<!--", searchStart);
    if (commentStart < 0) break;
    while (
      fenceIndex < fenceRanges.length &&
      fenceRanges[fenceIndex][1] <= commentStart
    ) {
      fenceIndex += 1;
    }
    if (
      fenceIndex < fenceRanges.length &&
      fenceRanges[fenceIndex][0] <= commentStart
    ) {
      searchStart = fenceRanges[fenceIndex][1];
      continue;
    }
    if (isEscapedMarkdownToken(content, commentStart)) {
      searchStart = commentStart + 4;
      continue;
    }
    const closeStart = content.indexOf("-->", commentStart + 4);
    const commentEnd = closeStart < 0 ? content.length : closeStart + 3;
    ranges.push([commentStart, commentEnd]);
    searchStart = commentEnd;
  }
  return ranges;
}

function isEscapedMarkdownToken(content, tokenStart) {
  let slashStart = tokenStart;
  while (slashStart > 0 && content[slashStart - 1] === "\\") {
    slashStart -= 1;
  }
  return (tokenStart - slashStart) % 2 === 1;
}

function mergeMarkdownRanges(leftRanges, rightRanges) {
  const ranges = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftRanges.length || rightIndex < rightRanges.length) {
    const takeLeft = rightIndex >= rightRanges.length ||
      (leftIndex < leftRanges.length &&
        leftRanges[leftIndex][0] <= rightRanges[rightIndex][0]);
    const nextRange = takeLeft
      ? leftRanges[leftIndex++]
      : rightRanges[rightIndex++];
    const previousRange = ranges.at(-1);
    if (previousRange && nextRange[0] <= previousRange[1]) {
      previousRange[1] = Math.max(previousRange[1], nextRange[1]);
    } else {
      ranges.push([...nextRange]);
    }
  }
  return ranges;
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

function markdownFenceRanges(content) {
  const ranges = [];
  let openFence;
  let lineStart = 0;
  for (const lineMatch of content.matchAll(/[^\r\n]*(?:\r?\n|$)/g)) {
    const line = lineMatch[0];
    if (line.length === 0 && lineStart >= content.length) break;
    const lineEnd = lineStart + line.length;
    const lineWithoutEnding = line.replace(/\r?\n$/, "");
    if (
      openFence !== undefined &&
      !continuesMarkdownFenceContainer(lineWithoutEnding, openFence.container)
    ) {
      ranges.push([openFence.start, lineStart]);
      openFence = undefined;
    }
    const fenceMatch = line.match(MARKDOWN_FENCE_LINE_PATTERN);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      const markerEnd = lineWithoutEnding.indexOf(marker) + marker.length;
      const hasOnlyClosingFenceWhitespace = /^[ \t]*$/.test(
        lineWithoutEnding.slice(markerEnd),
      );
      if (openFence === undefined) {
        const hasValidInfoString = marker[0] === "~" ||
          !lineWithoutEnding.slice(markerEnd).includes("`");
        if (!hasValidInfoString) {
          lineStart = lineEnd;
          continue;
        }
        openFence = {
          char: marker[0],
          length: marker.length,
          start: lineStart,
          container: markdownFenceContainer(fenceMatch[1]),
        };
      } else if (
        marker[0] === openFence.char && marker.length >= openFence.length &&
        hasOnlyClosingFenceWhitespace
      ) {
        ranges.push([openFence.start, lineEnd]);
        openFence = undefined;
      }
    }
    lineStart = lineEnd;
  }
  if (openFence !== undefined) ranges.push([openFence.start, content.length]);
  return ranges;
}

function markdownFenceContainer(prefix) {
  const listPrefixes = [...prefix.matchAll(MARKDOWN_LIST_PREFIX_PATTERN)];
  return {
    structuralPrefix: codeRabbitMarkdownPrefixSignature(
      prefix.replace(MARKDOWN_LIST_PREFIX_PATTERN, ""),
    ),
    continuationIndent: listPrefixes.length === 0
      ? 0
      : prefix.length - (prefix.lastIndexOf(">") + 1),
  };
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
  return (linePrefix.match(/[ \t]*$/)?.[0].length ?? 0) >=
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
