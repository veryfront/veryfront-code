import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

type Job = Record<string, unknown> & {
  steps?: Array<Record<string, unknown>>;
};

async function workflow(
  name: string,
): Promise<{ permissions?: Record<string, string>; jobs: Record<string, Job> }> {
  return parse(
    await Deno.readTextFile(new URL(`../../../.github/workflows/${name}`, import.meta.url)),
  ) as { permissions?: Record<string, string>; jobs: Record<string, Job> };
}

describe("CodeQL public analysis", () => {
  it("limits upload permissions to Analyze and budgets both jobs for the queue", async () => {
    const caller = await workflow("codeql.yml");
    const pool = await workflow("ci-public-pool.yml");
    assertEquals(caller.permissions, { actions: "read", contents: "read" });
    assertEquals(caller.jobs.analyze.permissions, {
      actions: "read",
      contents: "read",
      "security-events": "write",
    });
    assertEquals(pool.jobs.codeql["timeout-minutes"], 18);
    assertEquals(
      caller.jobs.analyze["timeout-minutes"],
      "${{ needs.public-analysis.result == 'skipped' && 25 || 5 }}",
    );
    // 23 minutes of execution leaves seven minutes for runner scheduling in
    // the merge queue's 30-minute check-response window.
    assert(Number(pool.jobs.codeql["timeout-minutes"]) + 5 <= 23);
  });

  it("calls the trusted pool only after the rollout switch is enabled", async () => {
    const jobs = (await workflow("codeql.yml")).jobs;
    const call = jobs["public-analysis"];
    assertExists(call);
    assertEquals(call.uses, "veryfront/veryfront-code/.github/workflows/ci-public-pool.yml@main");
    assertEquals(call.with, { job: "codeql" });
    assertEquals(call.permissions, { contents: "read" });
    const select = new Function(
      "github",
      "vars",
      "inputs",
      `return ${String(call.if).slice(4, -3)}`,
    );
    const scan = (await workflow("ci-public-pool.yml")).jobs.codeql;
    const runner = new Function(
      "github",
      "inputs",
      "vars",
      `return ${String(scan["runs-on"]).slice(4, -3)}`,
    );
    for (
      const eventName of ["pull_request", "push", "merge_group", "schedule", "workflow_dispatch"]
    ) {
      for (const ref of ["refs/heads/main", "refs/heads/feature"]) {
        for (const fork of [false, true]) {
          for (const actor of ["octocat", "dependabot[bot]"]) {
            for (const author of ["octocat", "dependabot[bot]"]) {
              const github = {
                event_name: eventName,
                ref,
                actor,
                repository: "veryfront/veryfront-code",
                event: {
                  pull_request: {
                    head: { repo: { full_name: fork ? "fork/code" : "veryfront/veryfront-code" } },
                    user: { login: author },
                  },
                },
              };
              const eligible = eventName === "merge_group" ||
                ((eventName === "push" || eventName === "workflow_dispatch") &&
                  ref === "refs/heads/main") ||
                (eventName === "pull_request" && !fork && actor !== "dependabot[bot]" &&
                  author !== "dependabot[bot]");
              for (const rollout of [undefined, "", "true", "enabled"]) {
                for (const pool of [undefined, "", "true", "veryfront-public"]) {
                  for (const requested of [undefined, false, true]) {
                    const canary = eventName === "workflow_dispatch" && ref === "refs/heads/main" &&
                      requested === true;
                    if (
                      select(github, { CI_CODEQL_PUBLIC: rollout, CI_RUNNER_PUBLIC: pool }, {
                        public_pool: requested,
                      })
                    ) {
                      assertEquals(
                        runner(github, { job: "codeql" }, { CI_RUNNER_PUBLIC: pool }),
                        "veryfront-public",
                      );
                    }
                    assertEquals(
                      Boolean(
                        select(github, { CI_CODEQL_PUBLIC: rollout, CI_RUNNER_PUBLIC: pool }, {
                          public_pool: requested,
                        }),
                      ),
                      pool === "veryfront-public" &&
                        ((rollout === "enabled" && eligible) || canary),
                      JSON.stringify({
                        eventName,
                        ref,
                        fork,
                        actor,
                        author,
                        rollout,
                        pool,
                        requested,
                      }),
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
    assertEquals(
      Boolean(select({ event_name: "merge_group", repository: "other/code" }, {
        CI_CODEQL_PUBLIC: "enabled",
        CI_RUNNER_PUBLIC: "veryfront-public",
      }, {})),
      false,
    );
  });

  it("keeps runner eligibility scoped while allowing a main-only canary", async () => {
    const job = (await workflow("ci-public-pool.yml")).jobs.codeql;
    assertExists(job);
    const select = new Function(
      "github",
      "inputs",
      "vars",
      `return ${String(job["runs-on"]).slice(4, -3)}`,
    );
    for (const event_name of ["push", "merge_group", "workflow_dispatch", "schedule"]) {
      for (const ref of ["refs/heads/main", "refs/heads/feature"]) {
        for (const enabled of [undefined, "", "true", "veryfront-public"]) {
          const expected = enabled === "veryfront-public" &&
            (event_name === "merge_group" ||
              ((event_name === "push" || event_name === "workflow_dispatch") &&
                ref === "refs/heads/main"));
          assertEquals(
            select({ event_name, ref, repository: "veryfront/veryfront-code" }, {}, {
              CI_RUNNER_PUBLIC: enabled,
            }),
            expected ? "veryfront-public" : "ubuntu-latest",
          );
        }
      }
    }
    for (const fork of [false, true]) {
      for (const actor of ["octocat", "dependabot[bot]"]) {
        assertEquals(
          select(
            {
              event_name: "pull_request",
              repository: "veryfront/veryfront-code",
              actor,
              event: {
                pull_request: {
                  head: { repo: { full_name: fork ? "fork/code" : "veryfront/veryfront-code" } },
                  user: { login: actor },
                },
              },
            },
            {},
            { CI_RUNNER_PUBLIC: "veryfront-public" },
          ),
          !fork && actor === "octocat" ? "veryfront-public" : "ubuntu-latest",
        );
      }
    }
  });

  it("runs the same queries without giving the pool an upload token", async () => {
    const pool = await workflow("ci-public-pool.yml");
    const scan = pool.jobs.codeql;
    assertExists(scan);
    assertEquals("permissions" in scan, false);
    const steps = scan.steps!;
    const init = steps.find((step) => String(step.uses).includes("codeql-action/init@"));
    const analyze = steps.find((step) => String(step.uses).includes("codeql-action/analyze@"));
    const artifact = steps.find((step) => String(step.uses).includes("upload-artifact@"));
    assertExists(init);
    assertExists(analyze);
    assertExists(artifact);
    assertEquals(init.with, {
      languages: "javascript-typescript",
      queries: "security-and-quality",
    });
    const options = analyze.with as Record<string, unknown>;
    assertEquals(options.upload, "never");
    assertEquals(options["upload-database"], false);
    assertEquals("skip-queries" in options, false);
    assertEquals(analyze["continue-on-error"], undefined);
    const upload = artifact.with as Record<string, unknown>;
    assertEquals(upload.name, "codeql-sarif-${{ github.run_id }}-${{ github.run_attempt }}");
    assertEquals((scan.outputs as Record<string, unknown>)["artifact-name"], upload.name);
    assertEquals(upload.path, `${options.output}/*.sarif`);
    assertEquals(upload["if-no-files-found"], "error");
    assertEquals(artifact.if, "${{ success() }}");
  });

  it("preserves Analyze and rejects every unsuccessful public scan result", async () => {
    const gate = (await workflow("codeql.yml")).jobs.analyze;
    assertExists(gate);
    assertEquals(gate.name, "Analyze");
    assertEquals(gate["runs-on"], "ubuntu-latest");
    assertEquals(gate.needs, ["public-analysis"]);
    assert(String(gate.if).includes("always()"));
    const check = gate.steps!.find((step) => step.id === "public-result");
    assertExists(check);
    for (const result of ["success", "failure", "cancelled", "skipped", "", "unexpected"]) {
      const output = await new Deno.Command("bash", {
        args: ["-e", "-c", String(check.run)],
        env: {
          PUBLIC_ANALYSIS_RESULT: result,
          PUBLIC_SOURCE_ROOT: "/source/checkout",
          PUBLIC_ARTIFACT_NAME: "codeql-sarif-42-1",
          GITHUB_RUN_ID: "42",
          GITHUB_RUN_ATTEMPT: "2",
        },
        stdout: "null",
        stderr: "null",
      }).output();
      assertEquals(output.success, result === "success", result);
    }
    const missingRoot = await new Deno.Command("bash", {
      args: ["-e", "-c", String(check.run)],
      env: { PUBLIC_ANALYSIS_RESULT: "success", PUBLIC_SOURCE_ROOT: "" },
      stdout: "null",
      stderr: "null",
    }).output();
    assertEquals(missingRoot.success, false);
    for (const name of ["", "codeql-sarif-43-1", "codeql-sarif-42-0", "codeql-sarif-42-other"]) {
      const invalidArtifact = await new Deno.Command("bash", {
        args: ["-e", "-c", String(check.run)],
        env: {
          PUBLIC_ANALYSIS_RESULT: "success",
          PUBLIC_SOURCE_ROOT: "/source/checkout",
          PUBLIC_ARTIFACT_NAME: name,
          GITHUB_RUN_ID: "42",
        },
        stdout: "null",
        stderr: "null",
      }).output();
      assertEquals(invalidArtifact.success, false, name);
    }
  });

  it("uploads only the successful producer artifact and retains hosted fallback", async () => {
    const gate = (await workflow("codeql.yml")).jobs.analyze;
    const steps = gate.steps!;
    const init = steps.find((step) => String(step.uses).includes("codeql-action/init@"));
    const hosted = steps.find((step) => step.id === "analyze");
    const download = steps.find((step) => step.id === "public-download");
    const upload = steps.find((step) => step.id === "public-upload");
    const guard = steps.find((step) => String(step.name).startsWith("Re-raise CodeQL"));
    assertExists(init);
    assertExists(hosted);
    assertExists(download);
    assertExists(upload);
    assertExists(guard);
    assertEquals(
      init.if,
      "${{ needs.public-analysis.result == 'skipped' && steps.checkout.outcome == 'success' }}",
    );
    assertEquals(hosted.if, init.if);
    assertEquals(
      download.if,
      "${{ needs.public-analysis.result == 'success' && steps.public-result.outcome == 'success' && steps.checkout.outcome == 'success' }}",
    );
    assertEquals(
      (download.with as Record<string, unknown>).name,
      "${{ needs.public-analysis.outputs.codeql-artifact-name }}",
    );
    assert(String(upload.if).includes("steps.public-download.outcome == 'success'"));
    assertEquals(
      (upload.with as Record<string, unknown>).category,
      "/language:javascript-typescript",
    );
    assertEquals(
      (upload.with as Record<string, unknown>).checkout_path,
      "${{ needs.public-analysis.outputs.codeql-source-root }}",
    );
    assertEquals((upload.with as Record<string, unknown>).ref, "${{ github.ref }}");
    assertEquals((upload.with as Record<string, unknown>).sha, "${{ github.sha }}");
    for (const id of ["checkout", "analyze", "public-result", "public-download", "public-upload"]) {
      assert(String(guard.if).includes(`steps.${id}.outcome == 'failure'`), id);
    }
    assert(String(guard.run).includes('if [ "$EVENT_NAME" != "merge_group" ]; then'));
    assert(String(guard.run).includes('if [ "$current" = "$TARGET_SHA" ]; then'));
  });
});
