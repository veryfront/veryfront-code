import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { parse } from "#std/yaml/parse";

// The workflows that cancel superseded pull_request runs share one
// concurrency contract:
//
// - first-attempt PR runs share a ref-scoped group, so a newer push cancels
//   the run it supersedes;
// - every other run gets a run-unique group. That covers main pushes,
//   merge_group entries, schedules, and workflow_dispatch, because GitHub
//   keeps one pending run per group and a shared group would let a later
//   event replace a pending run even with cancel-in-progress false. It also
//   covers manual reruns (run_attempt > 1), because a rerun of an older
//   attempt keeps its ref and would otherwise cancel the current head's run.
//
// See veryfront-studio#5544.
const CONCURRENCY_GROUP =
  "${{ github.event_name == 'pull_request' && github.run_attempt == '1' && format('{0}-{1}', github.workflow, github.ref) || format('{0}-{1}', github.workflow, github.run_id) }}";
const CANCEL_IN_PROGRESS = "${{ github.event_name == 'pull_request' }}";

const WORKFLOWS = [
  ".github/workflows/cicd.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/security-audit.yml",
];

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

describe("superseded-run cancellation contract", () => {
  for (const path of WORKFLOWS) {
    it(`${path} cancels superseded PR runs and nothing else`, async () => {
      const workflow = asRecord(
        parse(await Deno.readTextFile(path)),
        path,
      );
      const concurrency = asRecord(
        workflow.concurrency,
        `${path} concurrency`,
      );
      assertEquals(
        concurrency.group,
        CONCURRENCY_GROUP,
        `${path} concurrency group must scope first-attempt PR runs by ref and everything else by run id`,
      );
      assertEquals(
        concurrency["cancel-in-progress"],
        CANCEL_IN_PROGRESS,
        `${path} must cancel superseded pull_request runs only`,
      );
    });
  }
});
