import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const WORKFLOW_PR_GUARD =
  "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository";

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
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
  return Array.from(matches, (match) => match[1]);
}

function jobBlock(workflow: string, jobName: string): string {
  const marker = `\n  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  assert(start >= 0, `expected ${jobName} job to exist`);

  const rest = workflow.slice(start + marker.length);
  const nextJob = rest.search(/\n[ ]{2}[A-Za-z0-9_-]+:\n/);
  return nextJob === -1 ? rest : rest.slice(0, nextJob);
}

describe("repository hardening", () => {
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

    assertEquals(workflow.includes("secrets.NPM_TOKEN"), false);
    assertEquals(workflow.includes("NODE_AUTH_TOKEN"), false);
    assert(workflow.includes("id-token: write"));
    assert(workflow.includes("package-manager-cache: false"));
    assert(workflow.includes("npm publish --provenance --access public --tag rc"));
    assert(workflow.includes("npm publish --provenance --access public 2>&1"));
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
        assert(
          block.includes(WORKFLOW_PR_GUARD),
          `expected ${path} job ${jobName} to gate fork pull requests`,
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
