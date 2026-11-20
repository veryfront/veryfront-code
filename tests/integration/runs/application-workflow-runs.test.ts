import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { HandlerContext } from "#veryfront/types";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  bindApplicationWorkflowIdentity,
  resolveApplicationWorkflowSource,
} from "#veryfront/server/handlers/request/api/application-workflow-source.ts";
import { createRunsClient } from "#veryfront/runs/runs-client.ts";
import { createHostApplicationWorkflowRunner } from "#veryfront/server/handlers/request/api/application-workflow-runs.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const unrelatedRunId = "44444444-4444-4444-8444-444444444444";
const workflowId = "classify-message";
const projectSlug = "example-app";
const createdAt = "2026-07-26T12:00:00.000Z";
const context: HandlerContext = {
  projectId,
  projectSlug,
  adapter: createMockAdapter(),
  securityConfig: null,
  projectDir: "/app",
  resolvedEnvironment: "production",
  environmentName: "production",
  releaseId,
};
bindApplicationWorkflowIdentity(context);
const request = new Request("https://example-app.example.test/api/classify");
const input = {
  projectId,
  workflowId,
  target: "workflow:classify-message" as const,
  input: { mailId: "sample-1" },
};

describe("hosted app workflow Runs client", () => {
  it("starts and polls the workflow from the served release or preview without a project key", async () => {
    for (
      const ctx of [context, {
        ...context,
        releaseId: undefined,
        resolvedEnvironment: "preview" as const,
      }]
    ) {
      bindApplicationWorkflowIdentity(ctx);
      const paths: string[] = [];
      const bodies: Record<string, unknown>[] = [];
      const runner = createHostApplicationWorkflowRunner(request, ctx, {
        getHostEnv: () => "synthetic",
        createOriginBoundFetch: () => async (url, init) => {
          const outbound = new Request(url, init);
          const path = new URL(outbound.url).pathname;
          assertEquals(outbound.headers.get("authorization"), "Basic c3ludGhldGljOnN5bnRoZXRpYw==");
          paths.push(path);
          bodies.push(await outbound.json());
          return Response.json({
            id: runId,
            project_id: projectId,
            target: { type: "workflow", id: workflowId },
            status: path.endsWith("/cancel")
              ? "cancelled"
              : paths.length === 1
              ? "pending"
              : "completed",
            input: input.input,
            output: "request",
            created_at: createdAt,
            updated_at: createdAt,
          }, { headers: { ETag: '"run-v1"' } });
        },
      });
      assert(runner);
      await runner(async () => {
        const runs = createRunsClient();
        const started = await runs.createWorkflowRun(input);
        assertEquals(started.run.run_id, runId);
        let etag: string | null = null;
        const done = await runs.getRun(runId, {
          onHeaders: (headers) => {
            etag = headers.get("etag");
          },
        });
        assertEquals(etag, '"run-v1"');
        assertEquals(done.output, "request");
        assertEquals((await runs.cancel(runId)).cancelled, true);
        await assertRejects(async () => await runs.getRun(unrelatedRunId), Error);
      });
      assertEquals(paths, [
        "/internal/application-workflows/runs",
        `/internal/application-workflows/runs/${runId}/read`,
        `/internal/application-workflows/runs/${runId}/cancel`,
      ]);
      const source = ctx.resolvedEnvironment === "preview"
        ? { type: "branch", branchName: null }
        : { type: "environment", environmentName: "production", releaseId };
      assert(typeof bodies[0]?.requestId === "string");
      const proof = { projectId, projectSlug, source, workflowId, requestId: bodies[0].requestId };
      assertEquals(bodies, [{ ...proof, input: input.input }, proof, proof]);
    }
  });

  it("binds the default preview branch and preserves the name of a feature branch", () => {
    for (
      const [branch, expected] of [["main", null], ["00000000-0000-0000-0000-000000000000", null], [
        "draft",
        "draft",
      ]] as const
    ) {
      assertEquals(
        resolveApplicationWorkflowSource({
          ...context,
          releaseId: undefined,
          resolvedEnvironment: "preview",
          requestContext: { slug: projectSlug, token: "", mode: "preview", branch },
        }),
        { type: "branch", branchName: expected },
      );
    }
  });

  it("keeps explicit Runs credentials on the normal public API", async () => {
    const runner = createHostApplicationWorkflowRunner(request, context, {
      getHostEnv: () => undefined,
      createOriginBoundFetch: () => {
        throw new Error("Unexpected admission");
      },
    });
    assert(runner);
    await withMockFetch((url, init) => {
      assertEquals(String(url), `https://93.184.216.34/runs/${unrelatedRunId}`);
      assertEquals(new Headers(init?.headers).get("authorization"), "Bearer synthetic-key");
      return Promise.resolve(Response.json({ id: unrelatedRunId }));
    }, () =>
      runner(async () => {
        const external = createRunsClient({
          apiUrl: "https://93.184.216.34",
          authToken: "synthetic-key",
        });
        assertEquals((await external.getRun(unrelatedRunId)).id, unrelatedRunId);
      }));
  });

  it("keeps task creation, status and cancellation on the same ambient public SDK credential", async () => {
    const runner = createHostApplicationWorkflowRunner(request, context, {
      getHostEnv: () => "synthetic-internal",
      createOriginBoundFetch: () => () => {
        throw new Error("Unexpected workflow admission");
      },
    });
    assert(runner);
    const paths: string[] = [];
    await withMockFetch(
      (url, init) => {
        assertEquals(new Headers(init?.headers).get("authorization"), "Bearer ordinary-run-token");
        const path = new URL(String(url)).pathname;
        paths.push(path);
        return Promise.resolve(
          Response.json({
            id: unrelatedRunId,
            project_id: projectId,
            target: { type: "task", id: "import" },
            status: path.endsWith("/cancel") ? "cancelled" : "pending",
            input: {},
            created_at: createdAt,
            updated_at: createdAt,
          }),
        );
      },
      () =>
        runWithVeryfrontCloudContext({
          apiToken: "ordinary-run-token",
          apiBaseUrl: "https://93.184.216.34",
        }, () =>
          runner(async () => {
            const runs = createRunsClient();
            const accepted = await runs.createTaskRun({ projectId, target: "task:import" });
            assertEquals((await runs.getRun(accepted.run.run_id)).id, unrelatedRunId);
            assertEquals((await runs.cancel(accepted.run.run_id)).cancelled, true);
          })),
    );
    assertEquals(paths, ["/runs", `/runs/${unrelatedRunId}`, `/runs/${unrelatedRunId}/cancel`]);
  });

  it("uses a configured project key to read existing runs and create runs with public options", async () => {
    const runner = createHostApplicationWorkflowRunner(request, context, {
      getHostEnv: () => "synthetic-internal",
      createOriginBoundFetch: () => () => {
        throw new Error("Unexpected admission");
      },
    });
    assert(runner);
    const methods: string[] = [];
    await withMockFetch(
      (url, init) => {
        assertEquals(new URL(String(url)).origin, "https://api.veryfront.com");
        assertEquals(
          new Headers(init?.headers).get("authorization"),
          "Bearer synthetic-project-key",
        );
        methods.push(init?.method ?? "GET");
        if (init?.method === "POST") {
          assertEquals(
            new Headers(init.headers).get("idempotency-key"),
            "stable",
          );
        }
        return Promise.resolve(
          Response.json({
            id: unrelatedRunId,
            project_id: projectId,
            target: { type: "workflow", id: workflowId },
            status: "pending",
            input: null,
            created_at: createdAt,
            updated_at: createdAt,
          }),
        );
      },
      () =>
        runner(() =>
          runWithProjectEnv({ VERYFRONT_API_KEY: "synthetic-project-key" }, async () => {
            const runs = createRunsClient();
            const run = await runs.getRun(unrelatedRunId);
            assertEquals(run.id, unrelatedRunId);
            await runs.createWorkflowRun({
              ...input,
              runtimeTargetKind: "main_branch",
              idempotencyKey: "stable",
            });
          })
        ),
    );
    assertEquals(methods, ["GET", "POST"]);
  });

  it("reports when a caller asks for an idempotency key across hosted requests", async () => {
    const runner = createHostApplicationWorkflowRunner(request, context, {
      getHostEnv: () => "synthetic",
      createOriginBoundFetch: () => () => {
        throw new Error("Unexpected outbound request");
      },
    });
    assert(runner);
    await runner(() =>
      assertRejects(
        () =>
          createRunsClient().createWorkflowRun({
            ...input,
            idempotencyKey: "stable",
          }),
        Error,
        "idempotencyKey",
      )
    );
  });

  it("refuses an unbound context even when it claims a hosted project and release", async () => {
    let calls = 0;
    const runner = createHostApplicationWorkflowRunner(request, { ...context }, {
      getHostEnv: () => "synthetic",
      createOriginBoundFetch: () => () => {
        calls++;
        throw new Error("Unexpected admission");
      },
    });
    assert(runner);
    await runner(() =>
      assertRejects(() => createRunsClient().createWorkflowRun(input), Error, "unavailable")
    );
    assertEquals(calls, 0);
  });

  it("refuses foreign projects, source overrides, and a run ID that belongs to another request", async () => {
    let calls = 0;
    const runner = createHostApplicationWorkflowRunner(request, context, {
      getHostEnv: () => "synthetic",
      createOriginBoundFetch: () => () => {
        calls++;
        throw new Error("Unexpected outbound request");
      },
    });
    assert(runner);
    await runner(async () => {
      const runs = createRunsClient();
      await assertRejects(
        () => runs.createWorkflowRun({ ...input, projectId: unrelatedRunId }),
        Error,
        "another project",
      );
      await assertRejects(
        () => runs.createWorkflowRun({ ...input, runtimeTargetKind: "main_branch" }),
        Error,
        "source",
      );
      await assertRejects(() => runs.cancel(unrelatedRunId), Error, "Runs auth not configured");
      await assertRejects(
        async () => await runs.getRun(unrelatedRunId),
        Error,
        "Runs auth not configured",
      );
    });
    assertEquals(calls, 0);
  });

  it("polls a started workflow while streaming, then revokes it when the response settles", async () => {
    for (const terminal of ["complete", "pending-start", "cancel", "abort"] as const) {
      const controller = new AbortController();
      const paths: string[] = [];
      const admission = Promise.withResolvers<void>();
      const runner = createHostApplicationWorkflowRunner(
        new Request(request, { signal: controller.signal }),
        context,
        {
          getHostEnv: () => "synthetic",
          createOriginBoundFetch: () => async (url) => {
            paths.push(String(url));
            if (terminal === "pending-start") await admission.promise;
            return Promise.resolve(
              Response.json({
                id: runId,
                project_id: projectId,
                target: { type: "workflow", id: workflowId },
                status: "completed",
                input: null,
                output: "done",
                created_at: createdAt,
                updated_at: createdAt,
              }),
            );
          },
        },
      );
      assert(runner);
      const latePoll = Promise.withResolvers<void>();
      let deferred: Promise<unknown> | undefined;
      const res = await runner(async () => {
        const runs = createRunsClient();
        const started = runs.createWorkflowRun(input);
        if (terminal !== "pending-start") await started;
        deferred = latePoll.promise.then(async () => runs.getRun((await started).run.run_id));
        return new Response(
          new ReadableStream<Uint8Array>({
            async pull(stream) {
              const state = await runs.getRun((await started).run.run_id);
              stream.enqueue(new TextEncoder().encode(String(state.output)));
              stream.close();
            },
          }, { highWaterMark: 0 }),
        );
      });
      admission.resolve();
      if (terminal === "complete" || terminal === "pending-start") {
        assertEquals(await res.text(), "done");
      } else if (terminal === "cancel") await res.body!.cancel();
      else controller.abort();
      assert(deferred);
      const rejected = assertRejects(() => deferred!, Error);
      latePoll.resolve();
      await rejected;
      assertEquals(paths.length, terminal === "complete" || terminal === "pending-start" ? 2 : 1);
    }
  });

  it("does not start deferred work after the application request finishes", async () => {
    let calls = 0;
    const { promise, resolve } = Promise.withResolvers<void>();
    const runner = createHostApplicationWorkflowRunner(request, context, {
      getHostEnv: () => "synthetic",
      createOriginBoundFetch: () => () => {
        calls++;
        throw new Error("Unexpected outbound request");
      },
    });
    assert(runner);
    let deferred: Promise<unknown> | undefined;
    await runner(() => {
      deferred = promise.then(() => createRunsClient().createWorkflowRun(input));
      return Promise.resolve();
    });
    assert(deferred);
    const rejected = assertRejects(() => deferred!, Error, "unavailable");
    resolve();
    await rejected;
    assertEquals(calls, 0);
  });

  it("leaves local routes alone and refuses incomplete hosted release information", async () => {
    assertEquals(
      createHostApplicationWorkflowRunner(request, { ...context, isLocalProject: true }),
      undefined,
    );
    const runner = createHostApplicationWorkflowRunner(request, {
      ...context,
      releaseId: undefined,
    });
    assert(runner);
    await runner(() =>
      assertRejects(() => createRunsClient().createWorkflowRun(input), Error, "unavailable")
    );
  });
});
