/**
 * Decides whether a CI run may use the `veryfront-ci` runner pool.
 *
 * A push to main is eligible. A merge-queue run is eligible only when every
 * pull request whose changes are in the queued commit is authored by an
 * organization member or owner from a branch of this repository. The queued
 * commit contains every entry ahead of it that has not landed yet, so the
 * check covers all commits between the base branch and the queued head.
 *
 * Every unexpected input, API error, unresolved commit, or unknown author
 * returns `false`, which keeps the run on GitHub-hosted runners. CI loads this
 * file from the default branch, never from the code under test.
 */

export const RUNNER_TRUST_REPOSITORY = "veryfront/veryfront-code";
export const TRUSTED_AUTHOR_ASSOCIATIONS = Object.freeze(["MEMBER", "OWNER"]);
// Bot accounts that may author pull requests routed to the pool. None today.
export const TRUSTED_BOT_LOGINS = Object.freeze([]);
// Larger queued ranges are not paged; they run on GitHub-hosted runners.
export const MAX_QUEUED_COMMITS = 100;

const SHA = /^[0-9a-f]{40}$/;
const PAGE_SIZE = 100;

const MERGE_QUEUE_QUERY = `
  query($owner: String!, $repo: String!, $branch: String!) {
    repository(owner: $owner, name: $repo) {
      mergeQueue(branch: $branch) {
        entries(first: 100) {
          nodes {
            headCommit { oid }
            pullRequest { number }
          }
        }
      }
    }
  }
`;

/** Extract the pull request number from a merge-queue head ref. */
export function queuedPullNumber(headRef) {
  if (typeof headRef !== "string") return undefined;
  const match = /^(?:refs\/heads\/)?gh-readonly-queue\/.+\/pr-([1-9]\d*)-[0-9a-f]{40}$/
    .exec(headRef);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : undefined;
}

/** Return true when a REST pull request may run on the pool. */
export function isTrustedPullRequest(pull, repository = RUNNER_TRUST_REPOSITORY) {
  if (!pull || typeof pull !== "object") return false;
  if (!TRUSTED_AUTHOR_ASSOCIATIONS.includes(pull.author_association)) return false;
  const login = pull.user?.login;
  if (typeof login !== "string" || login.length === 0) return false;
  if (pull.user?.type !== "User" && !TRUSTED_BOT_LOGINS.includes(login)) return false;
  return pull.head?.repo?.full_name === repository &&
    pull.base?.repo?.full_name === repository;
}

async function queuedEntryPullNumbers(github, owner, repo, branch) {
  const result = await github.graphql(MERGE_QUEUE_QUERY, { owner, repo, branch });
  const nodes = result?.repository?.mergeQueue?.entries?.nodes;
  if (!Array.isArray(nodes)) throw new Error("merge queue entries are unavailable");
  const byCommit = new Map();
  for (const node of nodes) {
    const oid = node?.headCommit?.oid;
    const number = node?.pullRequest?.number;
    if (typeof oid === "string" && Number.isSafeInteger(number)) {
      byCommit.set(oid.toLowerCase(), number);
    }
  }
  return byCommit;
}

async function decideMergeGroup({ github, owner, repo, mergeGroup, log }) {
  const repository = `${owner}/${repo}`;
  const baseRef = mergeGroup?.base_ref;
  const headSha = String(mergeGroup?.head_sha ?? "").toLowerCase();
  const headPull = queuedPullNumber(mergeGroup?.head_ref);
  if (typeof baseRef !== "string" || !baseRef.startsWith("refs/heads/")) {
    log("merge group base ref is missing");
    return false;
  }
  if (!SHA.test(headSha) || headPull === undefined) {
    log("merge group head is malformed");
    return false;
  }
  const branch = baseRef.slice("refs/heads/".length);

  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${branch}...${headSha}`,
    per_page: PAGE_SIZE,
  });
  const commits = Array.isArray(comparison?.commits) ? comparison.commits : [];
  if (
    commits.length === 0 || commits.length > MAX_QUEUED_COMMITS ||
    comparison.total_commits !== commits.length
  ) {
    log("queued commit range is empty or too large");
    return false;
  }

  const queued = await queuedEntryPullNumbers(github, owner, repo, branch);
  const pullNumbers = new Set();
  for (const commit of commits) {
    const sha = String(commit?.sha ?? "").toLowerCase();
    if (!SHA.test(sha)) return false;
    const fromQueue = queued.get(sha);
    if (fromQueue !== undefined) {
      pullNumbers.add(fromQueue);
      continue;
    }
    const { data: associated } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: sha,
      per_page: PAGE_SIZE,
    });
    if (!Array.isArray(associated) || associated.length === 0) {
      log(`commit ${sha} has no pull request`);
      return false;
    }
    if (associated.length >= PAGE_SIZE) return false;
    for (const pull of associated) {
      if (!isTrustedPullRequest(pull, repository)) {
        log(`pull request #${pull?.number} is not eligible`);
        return false;
      }
      pullNumbers.add(pull.number);
    }
  }

  if (queued.get(headSha) !== headPull || !pullNumbers.has(headPull)) {
    log("merge group head does not match its queue entry");
    return false;
  }

  for (const number of pullNumbers) {
    const { data: pull } = await github.rest.pulls.get({ owner, repo, pull_number: number });
    if (!isTrustedPullRequest(pull, repository)) {
      log(`pull request #${number} is not eligible`);
      return false;
    }
  }
  return true;
}

/**
 * Decide runner eligibility. Never throws: any error returns false.
 *
 * @param {{
 *   github: { rest: any; graphql: (query: string, variables: object) => Promise<any> };
 *   repository: string;
 *   eventName: string;
 *   ref: string;
 *   mergeGroup?: { base_ref?: string; head_ref?: string; head_sha?: string };
 *   log?: (message: string) => void;
 * }} input
 */
export async function decideRunnerTrust(
  { github, repository, eventName, ref, mergeGroup, log = () => {} },
) {
  try {
    if (repository !== RUNNER_TRUST_REPOSITORY) return false;
    if (eventName === "push") return ref === "refs/heads/main";
    if (eventName !== "merge_group") return false;
    const [owner, repo] = repository.split("/");
    return await decideMergeGroup({ github, owner, repo, mergeGroup, log });
  } catch (error) {
    log(`runner trust check failed: ${error?.message ?? error}`);
    return false;
  }
}
