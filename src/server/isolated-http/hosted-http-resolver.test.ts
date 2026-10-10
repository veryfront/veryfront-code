import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-session.ts";
import { getExecutorHttpInstallSchema } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import { snapshotExecutorHttpApplicationConfiguration } from "./application-configuration.ts";
import {
  buildHostedHttpGenerationBindingInput,
  createHostedHttpResolver,
  createHostedHttpSourceRecordLookup,
  type HostedHttpResolverApi,
  type HostedHttpResolverOptions,
} from "./hosted-http-resolver.ts";

const SOURCE_API = "https://source-api.veryfront.test";
const REPOSITORY = "ghcr.io/veryfront/tenant-source";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RELEASE_ID = "33333333-3333-4333-8333-333333333333";
const IMAGE = `${REPOSITORY}@sha256:${"b".repeat(64)}`;

const SERVICE_ACCOUNT_ID = "service-account-renderer";

/** Unsigned JWT with the given payload; the resolver reads claims, the API verifies. */
function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

function serviceToken(projectId: string): string {
  return jwt({ userId: SERVICE_ACCOUNT_ID, scope: ["projects:read", "files:read"], projectId });
}

const authority = Object.freeze({
  projectId: PROJECT_ID,
  projectSlug: "project-a",
  releaseId: RELEASE_ID,
  environmentId: "environment-a",
  environmentName: "staging",
  sourceToken: serviceToken(PROJECT_ID),
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
    ...overrides,
  };
}

/** In-memory API that records which reads happened, in order. */
function fakeApi(overrides: Partial<HostedHttpResolverApi> = {}) {
  const calls: string[] = [];
  let variables: Record<string, string> = {
    APP_MESSAGE: "hello",
    OTEL_TRACES_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
  };
  const api: HostedHttpResolverApi = {
    readProject(value) {
      calls.push(`project:${value.sourceToken}`);
      return overrides.readProject?.(value, new AbortController().signal) ??
        Promise.resolve({ id: PROJECT_ID, name: "A", slug: "project-a" });
    },
    authorizeEnvironment(value, signal) {
      calls.push(`environment:${value.sourceToken}`);
      return overrides.authorizeEnvironment?.(value, signal) ??
        Promise.resolve(value.environmentId);
    },
    readEnvironment(value) {
      calls.push(`variables:${value.sourceToken}`);
      return Promise.resolve(variables);
    },
  };
  return {
    api,
    calls,
    setVariables(next: Record<string, string>) {
      variables = next;
    },
  };
}

const allocator: HostedExecutorAllocatorClient = {
  allocate: () => Promise.reject(new Error("not used")),
  observe: () => Promise.reject(new Error("not used")),
  renew: () => Promise.reject(new Error("not used")),
  release: () => Promise.reject(new Error("not used")),
};

function options(overrides: Partial<HostedHttpResolverOptions> = {}): HostedHttpResolverOptions {
  return {
    apiBaseUrl: "https://api.veryfront.test/api/",
    sourceApiOrigin: SOURCE_API,
    sourceImageRepository: REPOSITORY,
    serviceAccountId: SERVICE_ACCOUNT_ID,
    lookupSourceImage: createHostedHttpSourceRecordLookup([record()]),
    session: {
      expectedBrokerInstanceId: "broker-pod-uid",
      allocator,
      connectTransport: () => Promise.reject(new Error("not used")),
    },
    api: fakeApi().api,
    ...overrides,
  };
}

const signal = () => new AbortController().signal;

describe("hosted HTTP resolver", () => {
  it("authorizes identity with the source token before reading project variables", async () => {
    const fake = fakeApi();
    const resolve = createHostedHttpResolver(options({ api: fake.api }));
    const resolved = await resolve(authority, signal());

    assertEquals(fake.calls.slice(0, 2).toSorted(), [
      `environment:${authority.sourceToken}`,
      `project:${authority.sourceToken}`,
    ]);
    assertEquals(fake.calls[2], `variables:${authority.sourceToken}`);
    assertEquals(resolved.session.expectedImage, IMAGE);
    assertEquals(resolved.session.expectedBrokerInstanceId, "broker-pod-uid");
    assertEquals(resolved.session.request.owner, { scopeKind: "project", projectId: PROJECT_ID });
    assertEquals(resolved.session.request.source, { type: "release", releaseId: RELEASE_ID });
    assertEquals(resolved.session.request.executionProfile, "http");
    assert(resolved.session.request.requestedAt < resolved.session.request.prepareDeadlineAt);
    assertEquals(resolved.installation.environmentId, "environment-a");
    assertEquals(resolved.configuration?.variables, { APP_MESSAGE: "hello" });
    assertEquals(resolved.configuration?.projectSlug, "project-a");
    assertEquals(resolved.configuration?.configurationId, resolved.installation.configurationId);
    assertEquals(resolved.projectTracing?.status, "enabled");
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

  it("derives one opaque configuration identity per authorized configuration", async () => {
    const fake = fakeApi();
    const resolve = createHostedHttpResolver(options({ api: fake.api }));
    const first = await resolve(authority, signal());
    const same = await resolve(authority, signal());
    fake.setVariables({ APP_MESSAGE: "bye" });
    const changed = await resolve(authority, signal());
    assertEquals(first.installation.configurationId, same.installation.configurationId);
    assertNotEquals(first.installation.configurationId, changed.installation.configurationId);
    assert(!first.installation.configurationId.includes("hello"));
    assertNotEquals(first.session.request.allocationId, same.session.request.allocationId);
  });

  it("refuses a missing or oversized source token without any read", async () => {
    const fake = fakeApi();
    const resolve = createHostedHttpResolver(options({ api: fake.api }));
    await assertRejects(() => resolve({ ...authority, sourceToken: "" }, signal()));
    await assertRejects(() => resolve({ ...authority, sourceToken: "x".repeat(8193) }, signal()));
    assertEquals(fake.calls, []);
  });

  it("refuses credentials that are not bound to the requested project before any read", async () => {
    for (
      const [name, sourceToken] of [
        ["service credential for another project", serviceToken(FOREIGN_PROJECT_ID)],
        ["service credential without a project", jwt({ userId: SERVICE_ACCOUNT_ID, scope: [] })],
        ["user session", jwt({ userId: "user-1", scope: ["projects:read"] })],
        [
          "user session naming the project",
          jwt({ userId: "user-1", scope: ["projects:read"], projectId: PROJECT_ID }),
        ],
        [
          "user-scoped service credential",
          jwt({
            userId: SERVICE_ACCOUNT_ID,
            scope: ["projects:read", "user_read_id_user-1"],
            projectId: PROJECT_ID,
          }),
        ],
        ["credential without scopes", jwt({ userId: SERVICE_ACCOUNT_ID, projectId: PROJECT_ID })],
        ["opaque API key", "vf_api_key_0123456789abcdef"],
        ["malformed payload", "header.not-base64!.signature"],
      ] as const
    ) {
      const fake = fakeApi();
      const lookups: unknown[] = [];
      const resolve = createHostedHttpResolver(options({
        api: fake.api,
        lookupSourceImage: (request) => {
          lookups.push(request);
          return Promise.resolve(record());
        },
      }));
      await assertRejects(() => resolve({ ...authority, sourceToken }, signal()), Error, "", name);
      assertEquals([fake.calls, lookups], [[], []], name);
    }
  });

  it("refuses a rejected token or a foreign slug before reading project variables", async () => {
    for (
      const readProject of [
        () => Promise.reject(new Error("401")),
        () => Promise.resolve({ id: PROJECT_ID, name: "A", slug: "project-b" }),
        () => Promise.resolve({ id: FOREIGN_PROJECT_ID, name: "A", slug: "project-a" }),
        () => Promise.resolve("not a project"),
      ]
    ) {
      const fake = fakeApi({ readProject });
      const resolve = createHostedHttpResolver(options({ api: fake.api }));
      await assertRejects(() => resolve(authority, signal()));
      assertEquals(fake.calls.some((call) => call.startsWith("variables")), false);
    }
  });

  it("refuses an environment or release mismatch and cancels the other checks", async () => {
    let lookupAborted = false;
    const fake = fakeApi({
      authorizeEnvironment: () => Promise.reject(new Error("release mismatch")),
    });
    const resolve = createHostedHttpResolver(options({
      api: fake.api,
      lookupSourceImage: (_request, lookupSignal) =>
        new Promise((_resolve, reject) => {
          lookupSignal.addEventListener("abort", () => {
            lookupAborted = true;
            reject(lookupSignal.reason);
          });
        }),
    }));
    await assertRejects(() => resolve(authority, signal()), Error, "release mismatch");
    assert(lookupAborted, "the pending lookup must be canceled and settled");
    assertEquals(fake.calls.some((call) => call.startsWith("variables")), false);
  });

  it("refuses a published image that belongs to another project", async () => {
    const fake = fakeApi();
    const lookups: unknown[] = [];
    const resolve = createHostedHttpResolver(options({
      api: fake.api,
      lookupSourceImage(request) {
        lookups.push(request);
        return Promise.resolve(record({ project_id: FOREIGN_PROJECT_ID }));
      },
    }));
    await assertRejects(() => resolve(authority, signal()));
    assertEquals(lookups, [{ projectId: PROJECT_ID, releaseId: RELEASE_ID }]);
    assertEquals(fake.calls.some((call) => call.startsWith("variables")), false);
  });

  it("refuses publication records for another release, origin or repository", async () => {
    for (
      const mismatch of [
        { release_id: OTHER_RELEASE_ID },
        { api_origin: "https://other-api.veryfront.test" },
        { image: `ghcr.io/attacker/source@sha256:${"b".repeat(64)}` },
        { image: `${REPOSITORY}:latest` },
        { status: "pending" },
        { schema_version: 2 },
      ]
    ) {
      const resolve = createHostedHttpResolver(options({
        lookupSourceImage: () => Promise.resolve(record(mismatch)),
      }));
      await assertRejects(() => resolve(authority, signal()));
    }
    const trailing = createHostedHttpResolver(options({
      lookupSourceImage: () => Promise.resolve(record({ api_origin: `${SOURCE_API}/` })),
    }));
    assertEquals((await trailing(authority, signal())).session.expectedImage, IMAGE);
  });

  it("refuses a release with no publication record and an aborted lookup", async () => {
    const lookup = createHostedHttpSourceRecordLookup([
      record({ project_id: FOREIGN_PROJECT_ID }),
    ]);
    const resolve = createHostedHttpResolver(options({ lookupSourceImage: lookup }));
    await assertRejects(() => resolve(authority, signal()));
    const aborted = new AbortController();
    aborted.abort();
    await assertRejects(() =>
      Promise.resolve().then(() =>
        lookup({ projectId: FOREIGN_PROJECT_ID, releaseId: RELEASE_ID }, aborted.signal)
      )
    );
  });

  it("rejects host configuration it cannot enforce", () => {
    for (
      const invalid of [
        { apiBaseUrl: "http://api.veryfront.test" },
        { apiBaseUrl: "not a url" },
        { sourceApiOrigin: "https://source.test/path" },
        { sourceImageRepository: "" },
        { lookupSourceImage: undefined as never },
        { session: { ...options().session, expectedBrokerInstanceId: "" } },
        { serviceAccountId: "" },
        { serviceAccountId: undefined as never },
        { prepareTimeoutMs: 0 },
        { hardTimeoutMs: 10 },
        { prepareTimeoutMs: 120_000, hardTimeoutMs: 60_000 },
      ]
    ) {
      assertThrows(() => createHostedHttpResolver(options(invalid)), TypeError);
    }
  });

  it("refuses invalid, oversized or ambiguous publication records", () => {
    assertThrows(
      () =>
        createHostedHttpSourceRecordLookup([
          record(),
          record({ image: `${REPOSITORY}@sha256:${"e".repeat(64)}` }),
        ]),
      TypeError,
      "conflict",
    );
    assertThrows(() => createHostedHttpSourceRecordLookup([{ project_id: PROJECT_ID }]), TypeError);
    assertThrows(() => createHostedHttpSourceRecordLookup({} as never), TypeError);
    assertThrows(
      () =>
        createHostedHttpSourceRecordLookup([
          record(),
          record({ api_origin: "https://other-api.veryfront.test" }),
        ]),
      TypeError,
      "conflict",
    );
    // An identical duplicate, in any key order, is accepted.
    createHostedHttpSourceRecordLookup([record(), { ...record(), schema_version: 1 }]);
    createHostedHttpSourceRecordLookup([record(), record()]);
  });

  it("builds the generation binding inputs from the resolved installation", async () => {
    const resolve = createHostedHttpResolver(options());
    const resolved = await resolve(authority, signal());
    const binding = buildHostedHttpGenerationBindingInput(resolved);
    assertEquals(binding, {
      projectId: PROJECT_ID,
      environmentId: "environment-a",
      sourceSnapshotId: IMAGE,
      configurationId: resolved.installation.configurationId,
    });
    assert(Object.isFrozen(binding));
    assertThrows(
      () =>
        buildHostedHttpGenerationBindingInput({
          ...resolved,
          installation: {
            ...resolved.installation,
            owner: { scopeKind: "project", projectId: FOREIGN_PROJECT_ID },
          },
        }),
      TypeError,
    );
  });
});
