import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeHashBytes } from "#veryfront/utils";
import { FakeTime } from "#std/testing/time";
import {
  buildDependencyArtifactGraph,
  type DependencyArtifactBuildClient,
  type DependencyArtifactBuildTaskInput,
  dependencyArtifactUpstreamUrl,
  parseDependencyArtifactBuildTaskInput,
  runDependencyArtifactBuild,
} from "./dependency-artifact-builder.ts";
import { materializeDependencyArtifactGraph } from "./dependency-artifact-graph.ts";

const encoder = new TextEncoder();
const CONTROLLED_TIMEOUT_MS = 30_000;

const standardIdentity = {
  origin_key: "npm:public",
  package_name: "fixture-package",
  exact_version: "1.2.3",
  subpath: "feature",
  target: "es2022",
  profile: "standard-v1",
} as const;

function buildTaskInput(
  overrides: Partial<DependencyArtifactBuildTaskInput> = {},
): DependencyArtifactBuildTaskInput {
  return {
    artifact_id: "11111111-1111-4111-8111-111111111111",
    attempt_count: 1,
    identity: standardIdentity,
    policy: { decision: "allow" },
    ...overrides,
  };
}

function response(body: string, contentType = "text/javascript"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function fixtureFetch(
  fixtures: Record<string, Response | (() => Promise<Response>)>,
  calls: string[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const fixture = fixtures[url];
    if (!fixture) return new Response("missing", { status: 404 });
    return typeof fixture === "function" ? await fixture() : fixture;
  }) as typeof fetch;
}

async function settleBeforeWatchdog<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Dependency artifact timeout did not settle promptly")),
      1_000,
    );
  });
  try {
    return await Promise.race([promise, watchdog]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function recordingClient() {
  const events: Array<Record<string, unknown>> = [];
  const client: DependencyArtifactBuildClient = {
    async uploadAsset(input) {
      events.push({ kind: "upload", ...input });
      return { stored: true, existed: false };
    },
    async reportResult(input) {
      events.push({ kind: "result", ...input });
      return {
        accepted: true,
        state: input.result.outcome === "ready" ? "ready" : "failed",
      };
    },
  };
  return { client, events };
}

function failureCodeOf(
  result: Awaited<ReturnType<typeof runDependencyArtifactBuild>>,
): string {
  if (result.success) throw new Error("expected dependency artifact build failure");
  return result.failureCode;
}

describe("release-assets/dependency-artifact-builder", () => {
  it("constructs and fetches exact public npm URLs for scoped package subpaths", async () => {
    const identity = {
      ...standardIdentity,
      package_name: "@scope/pkg",
      subpath: "client/entry",
    };
    const rootUrl = dependencyArtifactUpstreamUrl(identity);
    assertEquals(
      rootUrl,
      "https://esm.sh/@scope/pkg@1.2.3/client/entry?external=react,react-dom&target=es2022",
    );

    const calls: string[] = [];
    const graph = await buildDependencyArtifactGraph(identity, {
      fetch: fixtureFetch({ [rootUrl]: response("export const value = 42;") }, calls),
    });
    assertEquals(calls, [rootUrl]);
    assertEquals(graph.assets.length, 1);
  });

  it("uses dedicated React profiles without duplicating React", () => {
    assertEquals(
      dependencyArtifactUpstreamUrl({
        ...standardIdentity,
        package_name: "react",
        subpath: "jsx-runtime",
        profile: "react-v1",
      }),
      "https://esm.sh/react@1.2.3/jsx-runtime?target=es2022",
    );
    assertEquals(
      dependencyArtifactUpstreamUrl({
        ...standardIdentity,
        package_name: "react-dom",
        subpath: "client",
        profile: "react-dom-v1",
      }),
      "https://esm.sh/react-dom@1.2.3/client?external=react&target=es2022",
    );
  });

  it("materializes a complete static and dynamic import closure", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const childUrl = "https://esm.sh/fixture-package@1.2.3/es2022/child.mjs";
    const dynamicUrl = "https://esm.sh/fixture-package@1.2.3/es2022/dynamic.mjs";
    const calls: string[] = [];
    const graph = await buildDependencyArtifactGraph(standardIdentity, {
      fetch: fixtureFetch({
        [rootUrl]: response(
          'import React from "react"; export { value } from "/fixture-package@1.2.3/es2022/child.mjs"; export const load = () => import("/fixture-package@1.2.3/es2022/dynamic.mjs");',
        ),
        [childUrl]: response("export const value = 42;"),
        [dynamicUrl]: response("export default 'dynamic';"),
      }, calls),
    });

    assertEquals(calls, [rootUrl, childUrl, dynamicUrl]);
    assertEquals(graph.assets.length, 3);
    assertEquals(graph.remainingExternalImportCount, 1);
    const root = graph.assets.find((asset) => asset.contentHash === graph.rootContentHash);
    assertEquals(root?.contentType, "text/javascript");
    const rootCode = new TextDecoder().decode(root?.bytes);
    assertEquals(/https?:\/\/[^"'\s]+/.test(rootCode), false);
    assertEquals(rootCode.includes('from "react"'), true);
    assertEquals((rootCode.match(/\/_vf\/assets\/[0-9a-f]{64}\.js/g) ?? []).length, 2);
  });

  it("fails an import of a package outside the profile's declared externals", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const calls: string[] = [];
    const { client, events } = recordingClient();
    const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
      fetch: fixtureFetch({
        [rootUrl]: response('import _ from "lodash"; export const value = 1;'),
      }, calls),
    });

    assertEquals(
      failureCodeOf(result),
      "undeclared_external",
      "a bare import outside the profile externals must fail the build",
    );
    assertEquals(calls, [rootUrl], "no further upstream fetch after an undeclared external");
    assertEquals(
      events.map((event) => event.kind),
      ["result"],
      "no asset upload for a rejected closure",
    );
  });

  it("rejects foreign hosts before fetching them", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const calls: string[] = [];
    const { client, events } = recordingClient();
    const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
      fetch: fixtureFetch({
        [rootUrl]: response('export * from "https://example.com/child.js";'),
      }, calls),
    });

    assertEquals(result.success, false);
    assertEquals(failureCodeOf(result), "upstream_host_denied");
    assertEquals(calls, [rootUrl]);
    assertEquals(events.map((event) => event.kind), ["result"]);
  });

  it("validates every redirect before fetching the next host", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const allowedRedirectUrl = "https://esm.sh/fixture-package@1.2.3/es2022/entry.mjs";
    const childUrl = "https://esm.sh/fixture-package@1.2.3/es2022/child.mjs";
    const calls: string[] = [];
    const graph = await buildDependencyArtifactGraph(standardIdentity, {
      fetch: fixtureFetch({
        [rootUrl]: new Response(null, {
          status: 302,
          headers: { location: allowedRedirectUrl },
        }),
        [allowedRedirectUrl]: response('export * from "./child.mjs";'),
        [childUrl]: response("export const value = 42;"),
      }, calls),
    });
    assertEquals(calls, [rootUrl, allowedRedirectUrl, childUrl]);
    assertEquals(graph.assets.length, 2);

    const deniedCalls: string[] = [];
    const { client } = recordingClient();
    const denied = await runDependencyArtifactBuild(buildTaskInput(), client, {
      fetch: fixtureFetch({
        [rootUrl]: new Response(null, {
          status: 302,
          headers: { location: "https://example.com/redirected.mjs" },
        }),
      }, deniedCalls),
    });
    assertEquals(failureCodeOf(denied), "upstream_host_denied");
    assertEquals(deniedCalls, [rootUrl]);
  });

  it("fails cyclic closures without uploading a partial graph", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const childUrl = "https://esm.sh/fixture-package@1.2.3/es2022/child.mjs";
    const { client, events } = recordingClient();
    const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
      fetch: fixtureFetch({
        [rootUrl]: response('export * from "/fixture-package@1.2.3/es2022/child.mjs";'),
        [childUrl]: response(`export * from ${JSON.stringify(rootUrl)};`),
      }),
    });

    assertEquals(result.success, false);
    assertEquals(failureCodeOf(result), "graph_cycle");
    assertEquals(events.map((event) => event.kind), ["result"]);
  });

  it("fails unsupported dynamic and auxiliary asset references", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    for (
      const [code, expectedFailureCode] of [
        ["export const load = (path) => import(path);", "non_literal_dynamic_import"],
        [
          "export const value = 1;\n//# sourceMappingURL=module.js.map",
          "unsupported_asset_reference",
        ],
        [
          'export const worker = new URL("./worker.wasm", import.meta.url);',
          "unsupported_asset_reference",
        ],
      ] as const
    ) {
      const calls: string[] = [];
      const { client, events } = recordingClient();
      const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
        fetch: fixtureFetch({ [rootUrl]: response(code) }, calls),
      });
      assertEquals(failureCodeOf(result), expectedFailureCode);
      assertEquals(calls, [rootUrl]);
      assertEquals(events.map((event) => event.kind), ["result"]);
    }
  });

  it("rejects JavaScript imports of CSS assets before upload", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const cssUrl = "https://esm.sh/fixture-package@1.2.3/styles.css";
    const calls: string[] = [];
    const { client, events } = recordingClient();

    const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
      fetch: fixtureFetch({
        [rootUrl]: response('import "./styles.css"; export const value = 1;'),
        [cssUrl]: response("body { color: red; }", "text/css"),
      }, calls),
    });

    assertEquals(failureCodeOf(result), "unsupported_asset_reference");
    assertEquals(calls, [rootUrl, cssUrl]);
    assertEquals(events.map((event) => event.kind), ["result"]);
  });

  it("enforces policy before starting any network work", async () => {
    let fetchCalls = 0;
    const { client, events } = recordingClient();
    const result = await runDependencyArtifactBuild(
      buildTaskInput({
        policy: {
          decision: "too_young",
          reason_code: "package_too_young",
          retry_after: "2026-08-02T00:00:00.000Z",
        },
      }),
      client,
      {
        fetch: (async () => {
          fetchCalls++;
          return response("export {};");
        }) as typeof fetch,
      },
    );

    assertEquals(fetchCalls, 0);
    assertEquals(failureCodeOf(result), "package_too_young");
    assertEquals(events.length, 1);
    assertEquals(events[0]?.kind, "result");
    assertEquals(
      (events[0]?.result as { retry_after?: string }).retry_after,
      "2026-08-02T00:00:00.000Z",
    );
  });

  it("preserves policy failure identity when result reporting is unavailable", async () => {
    let fetchCalls = 0;
    const metrics: string[] = [];
    const { client } = recordingClient();
    client.reportResult = () => Promise.reject(new Error("result API unavailable"));

    const result = await runDependencyArtifactBuild(
      buildTaskInput({
        policy: { decision: "deny", reason_code: "package_denied" },
      }),
      client,
      {
        fetch: (async () => {
          fetchCalls++;
          return response("export {};");
        }) as typeof fetch,
        recordMetric: (metric) => metrics.push(`${metric.event}:${metric.failureCode ?? ""}`),
      },
    );

    assertEquals(fetchCalls, 0);
    assertEquals(failureCodeOf(result), "package_denied");
    assertEquals(metrics, ["claim:", "failure:package_denied"]);
  });

  it("rejects HTML success responses and oversized assets", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    for (
      const [body, contentType, failureCode, maxAssetBytes] of [
        ["<!DOCTYPE html><title>ESM build failed</title>", "text/html", "upstream_html", 1024],
        [
          "<!DOCTYPE html><title>ESM build failed</title>",
          "text/javascript",
          "upstream_html",
          1024,
        ],
        ["export const value = 'too large';", "text/javascript", "asset_size_limit", 8],
      ] as const
    ) {
      const { client, events } = recordingClient();
      const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
        fetch: fixtureFetch({ [rootUrl]: response(body, contentType) }),
        limits: { maxAssetBytes },
      });
      assertEquals(result.success, false);
      assertEquals(failureCodeOf(result), failureCode);
      assertEquals(
        events.filter((event) => event.kind === "upload").length,
        0,
        "an upstream HTML body must never be uploaded as a dependency asset",
      );
    }
  });

  it("rejects unsuccessful and unsupported upstream responses", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    for (
      const [upstreamResponse, expectedFailureCode] of [
        [
          new Response("temporarily unavailable", {
            status: 503,
            headers: { "content-type": "text/plain" },
          }),
          "upstream_http_error",
        ],
        [response("binary", "application/wasm"), "upstream_content_type"],
      ] as const
    ) {
      const { client } = recordingClient();
      const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
        fetch: fixtureFetch({ [rootUrl]: upstreamResponse }),
      });
      assertEquals(result.success, false);
      assertEquals(failureCodeOf(result), expectedFailureCode);
    }
  });

  it("enforces total size, module count, and graph depth limits", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const childUrl = "https://esm.sh/fixture-package@1.2.3/es2022/child.mjs";
    const rootCode = 'export * from "/fixture-package@1.2.3/es2022/child.mjs";';
    const fixtures = () => ({
      [rootUrl]: response(rootCode),
      [childUrl]: response("export const child = true;"),
    });

    for (
      const [limits, expectedFailureCode] of [
        [{ maxTotalBytes: encoder.encode(rootCode).byteLength }, "graph_total_size_limit"],
        [{ maxModules: 1 }, "graph_module_limit"],
        [{ maxDepth: 0 }, "graph_depth_limit"],
      ] as const
    ) {
      const { client, events } = recordingClient();
      const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
        fetch: fixtureFetch(fixtures()),
        limits,
      });
      assertEquals(result.success, false);
      assertEquals(failureCodeOf(result), expectedFailureCode);
      assertEquals(events.map((event) => event.kind), ["result"]);
    }
  });

  it("bounds an upstream fetch that ignores AbortSignal", async () => {
    const { client } = recordingClient();
    const upstreamSignals: AbortSignal[] = [];
    let build!: ReturnType<typeof runDependencyArtifactBuild>;

    {
      using time = new FakeTime();
      build = runDependencyArtifactBuild(buildTaskInput(), client, {
        fetch: ((_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.signal) upstreamSignals.push(init.signal);
          return new Promise<Response>(() => undefined);
        }) as typeof fetch,
        limits: { timeoutMs: CONTROLLED_TIMEOUT_MS },
      });

      assertEquals(upstreamSignals.length, 1);
      assertEquals(upstreamSignals[0]?.aborted, false);
      await time.tickAsync(CONTROLLED_TIMEOUT_MS);
    }

    const result = await settleBeforeWatchdog(build);

    assertEquals(result.success, false);
    assertEquals(failureCodeOf(result), "upstream_timeout");
    assertEquals(upstreamSignals[0]?.aborted, true);
  });

  it("does not start an upstream fetch after its deadline expires", async () => {
    const { client } = recordingClient();
    let fetchCalls = 0;
    const result = await settleBeforeWatchdog(
      runDependencyArtifactBuild(buildTaskInput(), client, {
        fetch: (() => {
          fetchCalls++;
          return new Promise<Response>(() => undefined);
        }) as typeof fetch,
        limits: { timeoutMs: 0 },
      }),
    );

    assertEquals(result.success, false);
    assertEquals(failureCodeOf(result), "upstream_timeout");
    assertEquals(fetchCalls, 0);
  });

  it("bounds an upstream body read that never settles", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const { client } = recordingClient();
    const upstreamSignals: AbortSignal[] = [];
    let bodyCancelCalls = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel: () => {
        bodyCancelCalls++;
        return new Promise<void>(() => undefined);
      },
    });

    let build!: ReturnType<typeof runDependencyArtifactBuild>;
    {
      using time = new FakeTime();
      build = runDependencyArtifactBuild(buildTaskInput(), client, {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.signal) upstreamSignals.push(init.signal);
          assertEquals(String(input), rootUrl);
          return new Response(body, {
            headers: { "content-type": "text/javascript" },
          });
        }) as typeof fetch,
        limits: { timeoutMs: CONTROLLED_TIMEOUT_MS },
      });

      await time.tickAsync(0);
      assertEquals(upstreamSignals.length, 1);
      assertEquals(upstreamSignals[0]?.aborted, false);
      assertEquals(bodyCancelCalls, 0);
      await time.tickAsync(CONTROLLED_TIMEOUT_MS);
    }

    const result = await settleBeforeWatchdog(build);

    assertEquals(result.success, false);
    assertEquals(failureCodeOf(result), "upstream_timeout");
    assertEquals(upstreamSignals[0]?.aborted, true);
    assertEquals(bodyCancelCalls, 1);
  });

  it("rejects timeout values that JavaScript timers cannot represent", async () => {
    for (const timeoutMs of [-1, 1.5, 2_147_483_648, Number.NaN]) {
      let fetchCalls = 0;
      const { client } = recordingClient();
      const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
        fetch: (async () => {
          fetchCalls++;
          return response("export {};");
        }) as typeof fetch,
        limits: { timeoutMs },
      });

      assertEquals(result.success, false);
      assertEquals(failureCodeOf(result), "invalid_limits");
      assertEquals(fetchCalls, 0);
    }
  });

  it("rejects invalid build limits before starting network work", async () => {
    const invalidLimits = [
      { maxAssetBytes: Number.NaN },
      { maxTotalBytes: Number.POSITIVE_INFINITY },
      { maxModules: 0 },
      { maxDepth: -1 },
      { maxDepth: 1.5 },
    ];

    for (const limits of invalidLimits) {
      let fetchCalls = 0;
      const { client } = recordingClient();
      const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
        limits,
        fetch: (async () => {
          fetchCalls++;
          return response("export {};");
        }) as typeof fetch,
      });

      assertEquals(failureCodeOf(result), "invalid_limits");
      assertEquals(fetchCalls, 0);
    }
  });

  it("uploads hash-verified assets before publishing one ready graph", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const childUrl = "https://esm.sh/fixture-package@1.2.3/es2022/child.mjs";
    const { client, events } = recordingClient();
    const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
      fetch: fixtureFetch({
        [rootUrl]: response('export * from "/fixture-package@1.2.3/es2022/child.mjs";'),
        [childUrl]: response("export const value = 42;"),
      }),
    });

    assertEquals(result.success, true);
    assertEquals(events.map((event) => event.kind), ["upload", "upload", "result"]);
    for (const event of events.filter((item) => item.kind === "upload")) {
      assertEquals(
        await computeHashBytes(new Uint8Array(event.bytes as Uint8Array)),
        event.contentHash,
      );
    }
    const publication = events.at(-1)?.result as {
      outcome: string;
      graph: { root_content_hash: string; assets: unknown[] };
    };
    assertEquals(publication.outcome, "ready");
    if (!result.success) throw new Error("expected dependency artifact build success");
    assertEquals(publication.graph.root_content_hash, result.rootContentHash);
    assertEquals(publication.graph.assets.length, 2);
  });

  it("fails when the API does not confirm ready publication", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const { client, events } = recordingClient();
    client.reportResult = async (input) => {
      events.push({ kind: "result", ...input });
      return { accepted: true, state: "failed" };
    };

    const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
      fetch: fixtureFetch({ [rootUrl]: response("export const value = 42;") }),
    });

    assertEquals(result.success, false);
    assertEquals(failureCodeOf(result), "result_state_mismatch");
    assertEquals(events.map((event) => event.kind), ["upload", "result", "result"]);
  });

  it("preserves the build failure when failure reporting is unavailable", async () => {
    const rootUrl = dependencyArtifactUpstreamUrl(standardIdentity);
    const metrics: string[] = [];
    const { client } = recordingClient();
    client.reportResult = () => Promise.reject(new Error("result API unavailable"));

    const result = await runDependencyArtifactBuild(buildTaskInput(), client, {
      fetch: fixtureFetch({
        [rootUrl]: response("<!doctype html>", "text/html"),
      }),
      recordMetric: (metric) => metrics.push(`${metric.event}:${metric.failureCode ?? ""}`),
    });

    assertEquals(result.success, false);
    assertEquals(failureCodeOf(result), "upstream_html");
    assertEquals(metrics, ["claim:", "failure:upstream_html"]);
  });

  it("uses graph map keys as canonical source identities", async () => {
    const graph = await materializeDependencyArtifactGraph({
      modules: new Map([
        [
          "canonical-root",
          {
            id: "source-metadata-id",
            code: "export const value = 42;",
            contentType: "text/javascript" as const,
          },
        ],
      ]),
      rootId: "canonical-root",
      maxAssetBytes: 1_024,
      resolveImport: () => ({ kind: "external" }),
    });

    assertEquals(graph.assets[0]?.sourceId, "canonical-root");
    assertEquals(graph.rootContentHash, graph.assets[0]?.contentHash);
  });

  it("validates the lease-bound task input without accepting arbitrary URLs", () => {
    const parsed = parseDependencyArtifactBuildTaskInput(buildTaskInput());
    assertEquals(parsed.identity.exact_version, "1.2.3");

    try {
      parseDependencyArtifactBuildTaskInput({
        ...buildTaskInput(),
        upstream_url: "https://example.com/package.js",
      });
      throw new Error("expected validation failure");
    } catch (error) {
      assertStringIncludes(
        error instanceof Error ? error.message : String(error),
        "Invalid dependency artifact build input",
      );
    }

    for (const subpath of ["../escape", "feature/../../escape"]) {
      try {
        parseDependencyArtifactBuildTaskInput({
          ...buildTaskInput(),
          identity: { ...standardIdentity, subpath },
        });
        throw new Error("expected validation failure");
      } catch (error) {
        assertStringIncludes(
          error instanceof Error ? error.message : String(error),
          "Invalid dependency artifact build input",
        );
      }
    }

    try {
      parseDependencyArtifactBuildTaskInput({
        ...buildTaskInput(),
        attempt_count: Number.MAX_SAFE_INTEGER + 1,
      });
      throw new Error("expected validation failure");
    } catch (error) {
      assertStringIncludes(
        error instanceof Error ? error.message : String(error),
        "Invalid dependency artifact build input",
      );
    }

    for (const exactVersion of ["latest", "1.2"]) {
      try {
        parseDependencyArtifactBuildTaskInput({
          ...buildTaskInput(),
          identity: { ...standardIdentity, exact_version: exactVersion },
        });
        throw new Error("expected validation failure");
      } catch (error) {
        assertStringIncludes(
          error instanceof Error ? error.message : String(error),
          "Invalid dependency artifact build input",
        );
      }
    }

    try {
      parseDependencyArtifactBuildTaskInput({
        ...buildTaskInput(),
        identity: { ...standardIdentity, package_name: "react" },
      });
      throw new Error("expected validation failure");
    } catch (error) {
      assertStringIncludes(
        error instanceof Error ? error.message : String(error),
        "Invalid dependency artifact build input",
      );
    }

    try {
      parseDependencyArtifactBuildTaskInput({
        ...buildTaskInput(),
        artifact_id: "not-a-uuid",
      });
      throw new Error("expected validation failure");
    } catch (error) {
      assertStringIncludes(
        error instanceof Error ? error.message : String(error),
        "Invalid dependency artifact build input",
      );
    }

    assertEquals(parsed.identity.profile, "standard-v1");
  });
});
