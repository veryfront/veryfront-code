import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { HostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-session.ts";
import { getExecutorHttpInstallSchema } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import { snapshotExecutorHttpApplicationConfiguration } from "#veryfront/server/isolated-http/application-configuration.ts";
import {
  createHostedHttpResolver,
  createHostedHttpSourceRecordLookup,
  type HostedHttpResolverOptions,
} from "#veryfront/server/isolated-http/hosted-http-resolver.ts";

const API = "https://api.veryfront.test";
const SOURCE_API = "https://source-api.veryfront.test";
const REPOSITORY = "ghcr.io/veryfront/tenant-source";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RELEASE_ID = "33333333-3333-4333-8333-333333333333";
const IMAGE = `${REPOSITORY}@sha256:${"b".repeat(64)}`;

const authority = Object.freeze({
  projectId: PROJECT_ID,
  projectSlug: "project-a",
  releaseId: RELEASE_ID,
  environmentId: "environment-a",
  environmentName: "staging",
  sourceToken: "source-token",
});

function record(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    status: "resolved",
    api_origin: SOURCE_API,
    project_id: PROJECT_ID,
    release_id: RELEASE_ID,
    manifest_hash: "c".repeat(64),
    image: IMAGE,
    reference: { artifactId: "1", runId: "2", runAttempt: "1", sourceSHA: "d".repeat(40) },
    ...overrides,
  };
}

interface ApiState {
  project?: Response;
  environments?: Response;
  variables?: Response;
}

function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function apiFetch(state: ApiState = {}) {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    if (url === `${API}/projects/${PROJECT_ID}`) {
      return Promise.resolve(
        state.project ?? Response.json({ id: PROJECT_ID, name: "A", slug: "project-a" }),
      );
    }
    if (url === `${API}/projects/${PROJECT_ID}/environments`) {
      return Promise.resolve(
        state.environments ?? Response.json({
          data: [{
            id: "environment-a",
            name: "staging",
            deployment: { release: { id: RELEASE_ID } },
          }],
        }),
      );
    }
    if (url.startsWith(`${API}/projects/project-a/environment-variables?`)) {
      return Promise.resolve(
        state.variables ?? Response.json({
          data: [
            { key: "APP_MESSAGE", value: "hello" },
            { key: "OTEL_TRACES_ENABLED", value: "true" },
            { key: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "https://collector.example" },
          ],
        }),
      );
    }
    return Promise.reject(new Error(`Unexpected request ${url}`));
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const allocator: HostedExecutorAllocatorClient = {
  allocate: () => Promise.reject(new Error("not used")),
  observe: () => Promise.reject(new Error("not used")),
  renew: () => Promise.reject(new Error("not used")),
  release: () => Promise.reject(new Error("not used")),
};

function options(overrides: Partial<HostedHttpResolverOptions> = {}): HostedHttpResolverOptions {
  return {
    apiBaseUrl: API,
    sourceApiOrigin: SOURCE_API,
    sourceImageRepository: REPOSITORY,
    lookupSourceImage: createHostedHttpSourceRecordLookup([record()]),
    session: {
      expectedBrokerInstanceId: "broker-pod-uid",
      allocator,
      connectTransport: () => Promise.reject(new Error("not used")),
    },
    ...overrides,
  };
}

const signal = () => new AbortController().signal;

describe("hosted HTTP resolver", () => {
  it("authorizes identity with the source token before reading project configuration", async () => {
    const api = apiFetch();
    const resolve = createHostedHttpResolver(options());
    const resolved = await withMockFetch(api.fetch, () => resolve(authority, signal()));

    assertEquals(api.calls.map((call) => call.authorization), [
      "Bearer source-token",
      "Bearer source-token",
      "Bearer source-token",
    ]);
    assert(api.calls[2]!.url.includes("/environment-variables?environment_id=environment-a"));
    assertEquals(resolved.session.expectedImage, IMAGE);
    assertEquals(resolved.session.expectedBrokerInstanceId, "broker-pod-uid");
    assertEquals(resolved.session.request.owner, { scopeKind: "project", projectId: PROJECT_ID });
    assertEquals(resolved.session.request.source, { type: "release", releaseId: RELEASE_ID });
    assertEquals(resolved.session.request.executionProfile, "http");
    assertEquals(resolved.installation.environmentId, "environment-a");
    assertEquals(resolved.configuration.variables, { APP_MESSAGE: "hello" });
    assertEquals(resolved.configuration.projectSlug, "project-a");
    assertEquals(resolved.configuration.configurationId, resolved.installation.configurationId);
    assertEquals(resolved.projectTracing?.status, "enabled");
    if (resolved.projectTracing?.status === "enabled") {
      assertEquals(resolved.projectTracing.config.projectId, PROJECT_ID);
      assertEquals(resolved.projectTracing.config.environmentId, "environment-a");
    }
    // The broker accepts this configuration for the installation it builds.
    const installation = getExecutorHttpInstallSchema().parse({
      ...resolved.installation,
      binding: {
        allocationId: resolved.session.request.allocationId,
        invocationId: resolved.session.request.invocationId,
        generation: 1,
      },
    });
    snapshotExecutorHttpApplicationConfiguration(resolved.configuration, installation);
  });

  it("refuses a missing or oversized source token without contacting the API", async () => {
    const api = apiFetch();
    const resolve = createHostedHttpResolver(options());
    await withMockFetch(api.fetch, async () => {
      await assertRejects(() => resolve({ ...authority, sourceToken: "" }, signal()));
      await assertRejects(() => resolve({ ...authority, sourceToken: "x".repeat(8193) }, signal()));
    });
    assertEquals(api.calls, []);
  });

  it("refuses a rejected source token before reading project configuration", async () => {
    const api = apiFetch({ project: new Response("{}", { status: 401 }) });
    const resolve = createHostedHttpResolver(options());
    await withMockFetch(api.fetch, () => assertRejects(() => resolve(authority, signal())));
    assertEquals(api.calls.some((call) => call.url.includes("environment-variables")), false);
  });

  it("refuses a project slug that does not belong to the authorized project", async () => {
    const api = apiFetch({
      project: Response.json({ id: PROJECT_ID, name: "A", slug: "project-b" }),
    });
    const resolve = createHostedHttpResolver(options());
    await withMockFetch(api.fetch, () => assertRejects(() => resolve(authority, signal())));
    assertEquals(api.calls.some((call) => call.url.includes("environment-variables")), false);
  });

  it("refuses a release that is not the environment's active release", async () => {
    const api = apiFetch({
      environments: Response.json({
        data: [{
          id: "environment-a",
          name: "staging",
          deployment: { release: { id: OTHER_RELEASE_ID } },
        }],
      }),
    });
    const resolve = createHostedHttpResolver(options());
    await withMockFetch(api.fetch, () => assertRejects(() => resolve(authority, signal())));
    assertEquals(api.calls.some((call) => call.url.includes("environment-variables")), false);
  });

  it("refuses an environment identity that does not match the environment name", async () => {
    const resolve = createHostedHttpResolver(options());
    await withMockFetch(
      apiFetch().fetch,
      () =>
        assertRejects(() => resolve({ ...authority, environmentId: "environment-b" }, signal())),
    );
  });

  it("refuses a published image that belongs to another project", async () => {
    const api = apiFetch();
    const lookups: unknown[] = [];
    const resolve = createHostedHttpResolver(options({
      lookupSourceImage(request) {
        lookups.push(request);
        return Promise.resolve(record({ project_id: FOREIGN_PROJECT_ID }));
      },
    }));
    await withMockFetch(api.fetch, () => assertRejects(() => resolve(authority, signal())));
    assertEquals(lookups, [{ projectId: PROJECT_ID, releaseId: RELEASE_ID }]);
    assertEquals(api.calls.some((call) => call.url.includes("environment-variables")), false);
  });
});
