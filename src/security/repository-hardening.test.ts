import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const WORKFLOW_PR_GUARD =
  "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";
const CREATE_APP_TOKEN_ACTION =
  "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1";

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(`../../${path}`, import.meta.url));
}

function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function topLevelJobNames(workflow: string): string[] {
  const jobsStart = workflow.indexOf("\njobs:\n");
  if (jobsStart === -1) return [];

  const jobsBlock = workflow.slice(jobsStart + "\njobs:\n".length);
  const matches = jobsBlock.matchAll(/^[ ]{2}([A-Za-z0-9_-]+):\s*$/gm);
  return Array.from(matches, (match) => match[1]!);
}

function jobBlock(workflow: string, jobName: string): string {
  const marker = `\n  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  assert(start >= 0, `expected ${jobName} job to exist`);

  const rest = workflow.slice(start + marker.length);
  const nextJob = rest.search(/\n[ ]{2}[A-Za-z0-9_-]+:\n/);
  return nextJob === -1 ? rest : rest.slice(0, nextJob);
}

function workflowStepBlock(workflow: string, stepName: string): string {
  const marker = `      - name: ${stepName}\n`;
  const start = workflow.indexOf(marker);
  assert(start >= 0, `expected ${stepName} step to exist`);

  const nextStep = workflow.indexOf("\n      - ", start + marker.length);
  return nextStep === -1 ? workflow.slice(start) : workflow.slice(start, nextStep);
}

describe("repository hardening", () => {
  it("keeps the client bundle report authoritative and its comment best-effort", async () => {
    const workflow = await readText(".github/workflows/client-bundle-report.yml");
    const compute = workflowStepBlock(workflow, "Compute client bundle report");
    const comment = workflowStepBlock(workflow, "Post sticky PR comment");

    assert(compute.includes("deno task client-bundle:report"));
    assert(!compute.includes("continue-on-error"));
    assert(comment.includes("continue-on-error: true"));
    assert(comment.includes("retries: 3"));
  });

  it("keeps CODEOWNERS in force for public governance files", async () => {
    const codeowners = await readText(".github/CODEOWNERS");

    assert(codeowners.includes("* @kojiwakayama @kwakayama"));
    assert(codeowners.includes("/.github/ @kojiwakayama @kwakayama"));
    assert(codeowners.includes("/SECURITY.md @kojiwakayama @kwakayama"));
    assert(codeowners.includes("/.github/CODEOWNERS @kojiwakayama @kwakayama"));
  });

  it("documents the owner-only public repository hardening settings", async () => {
    const checklist = await readText(".github/SECURITY-HARDENING.md");

    for (
      const required of [
        "Private vulnerability reporting",
        "Secret scanning",
        "Push protection",
        "Code security",
        "Dependabot security updates",
        "External fork pull requests",
        "GitHub App release credentials",
        "VERYFRONT_RELEASE_APP_CLIENT_ID",
        "VERYFRONT_DOCS_APP_CLIENT_ID",
        "HOMEBREW_TAP_APP_CLIENT_ID",
        "GH_PAT_VERYFRONT",
        "GH_PAT_HOMEBREW_TAP",
      ]
    ) {
      assert(
        checklist.includes(required),
        `expected hardening checklist to mention ${required}`,
      );
    }
  });

  it("keeps SECURITY.md aligned with the external fork CI policy", async () => {
    const policy = await readText("SECURITY.md");

    assert(policy.includes("same-repository pull requests"));
    assert(policy.includes("External fork pull requests do not run code-checking CI"));
  });

  it("keeps npm publishing tokenless and provenance-backed", async () => {
    const workflow = await readText(".github/workflows/cicd.yml");
    // The publish commands live in the shared CI script; the workflow only
    // invokes its modes with OIDC credentials.
    const publishScript = await readText("scripts/ci/publish-npm-packages.sh");

    assertEquals(workflow.includes("secrets.NPM_TOKEN"), false);
    assertEquals(workflow.includes("NODE_AUTH_TOKEN"), false);
    assert(workflow.includes("id-token: write"));
    assert(workflow.includes("package-manager-cache: false"));
    assert(workflow.includes("scripts/ci/publish-npm-packages.sh rc-publish"));
    assert(workflow.includes("scripts/ci/publish-npm-packages.sh preflight"));
    assert(workflow.includes("scripts/ci/publish-npm-packages.sh release-publish"));
    assert(workflow.includes("deno run -A scripts/ci/prepare-rc-build.ts"));

    const prerelease = jobBlock(workflow, "prerelease");
    assert(
      prerelease.indexOf("deno run -A scripts/ci/prepare-rc-build.ts") <
        prerelease.indexOf("deno task build:npm"),
    );

    assertEquals(publishScript.includes("NPM_TOKEN"), false);
    assertEquals(publishScript.includes("NODE_AUTH_TOKEN"), false);
    assert(publishScript.includes("npm publish --provenance --access public --tag rc"));
    assert(publishScript.includes("npm publish --provenance --access public 2>&1"));
  });

  it("only publishes a stable version after a version change or manual dispatch", async () => {
    const workflow = await readText(".github/workflows/cicd.yml");
    const versionCheck = jobBlock(workflow, "version-check");
    const prerelease = jobBlock(workflow, "prerelease");
    const release = jobBlock(workflow, "release");

    assert(versionCheck.includes("stable_release_requested:"));
    assert(versionCheck.includes("fetch-depth: 0"));
    assert(
      versionCheck.includes(
        "bash scripts/ci/stable-release-requested.sh",
      ),
    );
    assert(versionCheck.includes("github.event.before"));
    assert(
      release.includes(
        "needs.version-check.outputs.stable_release_requested == 'true'",
      ),
    );
    assert(
      release.includes("needs.version-check.outputs.is_stable == 'true'"),
    );
    assertEquals(prerelease.includes("stable_release_requested"), false);
  });

  it("uses scoped GitHub App tokens instead of release PATs", async () => {
    const releaseWorkflow = await readText(".github/workflows/cicd.yml");
    const docsWorkflow = await readText(".github/workflows/sync-docs.yml");
    const workflows = `${releaseWorkflow}\n${docsWorkflow}`;

    assertEquals(workflows.includes("GH_PAT_"), false);
    assertEquals(workflows.includes("HOMEBREW_TAP_PAT"), false);

    for (
      const required of [
        CREATE_APP_TOKEN_ACTION,
        "client-id: ${{ vars.VERYFRONT_RELEASE_APP_CLIENT_ID }}",
        "private-key: ${{ secrets.VERYFRONT_RELEASE_APP_PRIVATE_KEY }}",
        "client-id: ${{ vars.VERYFRONT_DOCS_APP_CLIENT_ID }}",
        "private-key: ${{ secrets.VERYFRONT_DOCS_APP_PRIVATE_KEY }}",
        "client-id: ${{ vars.HOMEBREW_TAP_APP_CLIENT_ID }}",
        "private-key: ${{ secrets.HOMEBREW_TAP_APP_PRIVATE_KEY }}",
        "repositories: |",
        "veryfront-server",
        "veryfront-job-runner",
        "veryfront-sandbox",
        "veryfront-docs",
        "homebrew-tap",
        "permission-contents: write",
        "permission-pull-requests: write",
        "steps.release-app-token.outputs.token",
        "steps.docs-app-token.outputs.token",
        "steps.homebrew-app-token.outputs.token",
      ]
    ) {
      assert(
        workflows.includes(required),
        `expected workflows to use ${required}`,
      );
    }
  });

  it("scopes Homebrew tap pull request lookup to the pushed repository owner", async () => {
    const workflow = await readText(".github/workflows/cicd.yml");
    const updateHomebrew = jobBlock(workflow, "update-homebrew");

    assertEquals(
      updateHomebrew.includes("gh pr list"),
      false,
      "expected Homebrew updates not to look up PRs by unqualified branch name",
    );
    assert(
      updateHomebrew.includes("gh api repos/veryfront/homebrew-tap/pulls"),
      "expected Homebrew updates to query tap PRs through the Pulls API",
    );
    assert(
      updateHomebrew.includes("--method GET"),
      "expected gh api fields to remain query parameters instead of switching the lookup to POST",
    );
    assert(
      updateHomebrew.includes('-f head="veryfront:${BRANCH}"'),
      "expected Homebrew tap PR lookup to be scoped to the pushed repository owner and branch",
    );
    assert(
      updateHomebrew.includes("gh pr create"),
      "expected Homebrew updates to create tap PRs with gh pr create",
    );
    assert(
      updateHomebrew.includes("--repo veryfront/homebrew-tap"),
      "expected Homebrew tap PR commands to stay scoped to the tap repository",
    );
    assertEquals(
      updateHomebrew.match(/--head "\$\{BRANCH\}"/g)?.length,
      1,
      "expected only PR creation to pass a branch-only head after lookup is owner-scoped",
    );
    assert(
      updateHomebrew.includes('PR_NUMBER="${PR_URL##*/}"'),
      "expected Homebrew tap PR creation to read the number from the returned URL",
    );
    assert(
      updateHomebrew.includes('GH_TOKEN="${HOMEBREW_TAP_TOKEN}"'),
      "expected Homebrew tap PR commands to use the scoped App token",
    );
  });

  it("does not run npm lifecycle scripts while building the npm package", async () => {
    const buildScript = await readText("scripts/build/build-npm-dnt.ts");

    assert(buildScript.includes('"install", "--ignore-scripts", "--legacy-peer-deps"'));
  });

  it("does not execute code-checking workflows for fork pull requests", async () => {
    for (
      const path of [
        ".github/workflows/cicd.yml",
        ".github/workflows/codeql.yml",
        ".github/workflows/security-audit.yml",
      ]
    ) {
      const workflow = stripComments(await readText(path));
      assert(
        workflow.includes("pull_request:"),
        `expected ${path} to define pull_request triggers`,
      );

      const jobs = topLevelJobNames(workflow);
      assert(jobs.length > 0, `expected ${path} to define jobs`);

      for (const jobName of jobs) {
        const block = jobBlock(workflow, jobName);
        const jobIf = block.split("\n").find((line) => /^ {4}if:/.test(line));
        assert(
          jobIf !== undefined,
          `expected ${path} job ${jobName} to declare a job-level if: condition`,
        );
        assert(
          jobIf.includes(WORKFLOW_PR_GUARD),
          `expected ${path} job ${jobName} to carry the fork guard on its own job-level if:, not on a step`,
        );
      }
    }
  });

  it("leaves the CLA workflow non-executing for contributor code", async () => {
    const workflow = await readText(".github/workflows/cla.yml");

    assert(workflow.includes("pull_request_target:"));
    assertEquals(workflow.includes("actions/checkout"), false);
  });
});
