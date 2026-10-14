import { parse } from "#std/yaml/parse";

/** The only way cicd.yml may call the public pool workflow. */
export const PUBLIC_POOL_WORKFLOW_REF =
  "veryfront/veryfront-code/.github/workflows/ci-public-pool.yml@main";

const POOL_WORKFLOW_URL = new URL(
  "../../.github/workflows/ci-public-pool.yml",
  import.meta.url,
);
const EXPRESSION = /^\$\{\{ (.+) \}\}$/;

type Job = Record<string, unknown>;

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Returns the cicd.yml jobs with every call to the public pool workflow
 * replaced by the job it runs: the caller keeps its name, condition, needs
 * and matrix, and takes `runs-on`, `timeout-minutes` and `steps` from the
 * called job. Each `inputs.<name>` in the called job is rewritten to the
 * expression the caller passes, so a contract written against cicd.yml reads
 * the same values it did before the job moved.
 */
export async function inlinePublicPoolJobs(
  workflow: Record<string, unknown>,
): Promise<Record<string, Job>> {
  const pool = asRecord(
    parse(await Deno.readTextFile(POOL_WORKFLOW_URL)),
    "ci-public-pool.yml",
  );
  const poolJobs = asRecord(pool.jobs, "ci-public-pool.yml jobs");
  const jobs = asRecord(workflow.jobs, "cicd.yml jobs");
  return Object.fromEntries(
    Object.entries(jobs).map(([name, value]) => {
      const job = asRecord(value, name);
      if (job.uses !== PUBLIC_POOL_WORKFLOW_REF) return [name, job];
      const { uses: _uses, with: withValue, ...caller } = job;
      const inputs = asRecord(withValue, `${name} with`);
      const called = asRecord(
        poolJobs[String(inputs.job)],
        `pool job ${inputs.job}`,
      );
      let text = JSON.stringify({
        "runs-on": called["runs-on"],
        "timeout-minutes": called["timeout-minutes"],
        // Input validation belongs to the pool workflow contract.
        steps: (called.steps as Job[]).filter((step) =>
          step.name !== "Validate inputs"
        ),
      });
      for (const [input, passed] of Object.entries(inputs)) {
        const expression = String(passed).match(EXPRESSION)?.[1];
        if (expression === undefined) continue;
        text = text.replaceAll(`inputs.${input}`, expression);
      }
      return [name, { ...caller, ...JSON.parse(text) }];
    }),
  );
}
