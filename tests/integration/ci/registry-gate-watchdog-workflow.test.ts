import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected YAML object");
  }
  return value as Record<string, unknown>;
}

describe("registry watchdog workflow contract", () => {
  it("uses a ten-minute schedule and main-only mutation with bounded setup", async () => {
    const workflow = record(
      parse(
        await Deno.readTextFile(
          new URL(
            "../../../.github/workflows/registry-gate-watchdog.yml",
            import.meta.url,
          ),
        ),
      ),
    );
    const on = record(workflow.on);
    assertEquals(on.schedule, [{ cron: "*/10 * * * *" }]);
    assertEquals(
      record(record(record(on.workflow_dispatch).inputs).dry_run).default,
      true,
    );
    assertEquals(workflow.permissions, { contents: "read" });
    assertEquals(workflow.concurrency, {
      group: "registry-gate-watchdog",
      "cancel-in-progress": false,
    });
    const jobs = record(workflow.jobs);
    for (const value of Object.values(jobs)) {
      const job = record(value);
      assertStringIncludes(
        String(job.if),
        "github.event.pull_request.head.repo.full_name == github.repository",
      );
      const steps = (job.steps as unknown[]).map(record);
      const setup = steps.find((step) => step.uses === "./.github/actions/setup-deno")!;
      assertEquals(setup["timeout-minutes"], 5);
    }
    const watchdog = record(jobs.watchdog);
    assertEquals(watchdog.needs, "contract");
    assertStringIncludes(
      String(watchdog.if),
      "github.event_name == 'schedule'",
    );
    assertStringIncludes(
      String(watchdog.if),
      "github.ref == 'refs/heads/main'",
    );
    assertEquals(watchdog.permissions, {
      contents: "read",
      actions: "write",
      "pull-requests": "write",
    });
    const steps = (watchdog.steps as unknown[]).map(record);
    assertEquals(record(steps[0]!.with).ref, "main");
    assertEquals(record(steps[0]!.with)["persist-credentials"], false);
    const execute = steps.find((step) => step.name === "Recover an unstarted RC gate")!;
    assertStringIncludes(String(execute.run), "--allow-net=api.github.com");
    assertStringIncludes(String(execute.run), "--dry-run");
    assertStringIncludes(String(execute.run), "--run-id=$RUN_ID");
  });
});
