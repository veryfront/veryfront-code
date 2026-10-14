import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedHttpFixture } from "../../../tests/fixtures/hosted-http-broker.ts";
import type { HostedHttpRequestAuthority } from "./hosted-http-ingress.ts";
import { createInstalledHttpBroker } from "./installed-http-broker.ts";

const identity = {
  projectId: "project-a",
  projectSlug: "project-a",
  releaseId: "release-a",
  environmentId: "environment-a",
  environmentName: "production",
};
const configuration = {
  ...identity,
  configurationId: "config-a",
  variables: { PUBLIC_MARKER: "A" },
};
const authority = { ...identity, sourceToken: "source-only-token" };
function fixture(
  authorize: (value: HostedHttpRequestAuthority, signal: AbortSignal) => Promise<void> =
    async () => {},
) {
  const f = createHostedHttpFixture(() => new Response("A"));
  return createInstalledHttpBroker({
    installations: [{ image: f.input.session.expectedImage, configuration }],
    expectedBrokerInstanceId: "broker-a",
    allocator: f.input.session.allocator,
    connectTransport: f.input.session.connectTransport,
    maxActive: 2,
    authorize,
  });
}

describe("installed HTTP broker", () => {
  it("retains authorizer-owned raw work after a deadline refusal", async () => {
    const work = Promise.withResolvers<void>();
    let pending = 0;
    const authorize = Object.defineProperties(async () => {
      pending = 1;
      throw new Error("deadline");
    }, {
      pending: { get: () => pending },
      settled: { get: () => pending ? work.promise : Promise.resolve() },
    });
    const b = fixture(authorize);
    let done = false;
    const settled = b.settled.then(() => {
      done = true;
    });
    try {
      await assertRejects(() => b.hostedHttp.resolve(authority, new AbortController().signal));
      const notice = await b.shutdown();
      assertEquals(notice.pending, 1);
      for (let turn = 0; turn < 10; turn++) await Promise.resolve();
      assertEquals(done, false);
      work.resolve();
      await settled;
      assertEquals(done, true);
    } finally {
      work.resolve();
      await b.shutdown();
    }
  });
  it("bounds execution from authorization completion and retains the overall lifetime cap", async () => {
    const f = createHostedHttpFixture(() => new Response("A"));
    const options = {
      installations: [{ image: f.input.session.expectedImage, configuration }],
      expectedBrokerInstanceId: "broker-a",
      allocator: f.input.session.allocator,
      connectTransport: f.input.session.connectTransport,
      maxActive: 1,
      authorize: async () => {},
      requestLifetimeMs: 180_000,
    };
    const originalNow = Date.now;
    const requestedAt = 1_700_000_000_000;
    let now = requestedAt;
    Date.now = () => now;
    try {
      for (
        const expected of [
          { lifetime: 180_000, authorization: 1_250, prepare: 31_250, hard: 181_250 },
          { lifetime: 5, authorization: 1_000, prepare: 1_005, hard: 1_005 },
          {
            lifetime: 86_400_000,
            authorization: 86_390_000,
            prepare: 86_400_000,
            hard: 86_400_000,
          },
        ]
      ) {
        now = requestedAt;
        const b = createInstalledHttpBroker({
          ...options,
          requestLifetimeMs: expected.lifetime,
          authorize: async () => {
            now += expected.authorization;
          },
        });
        try {
          const input = await b.hostedHttp.resolve(authority, new AbortController().signal);
          assertEquals(input.session.request.requestedAt, requestedAt);
          assertEquals(input.session.request.hardDeadlineAt, requestedAt + expected.hard);
          assertEquals(input.session.request.prepareDeadlineAt, requestedAt + expected.prepare);
        } finally {
          await b.shutdown();
        }
      }
      for (const requestLifetimeMs of [0, -1, NaN, Infinity, 1.5, 86_400_001]) {
        assertThrows(() => createInstalledHttpBroker({ ...options, requestLifetimeMs }), TypeError);
      }
    } finally {
      Date.now = originalNow;
    }
  });
  it("refuses each foreign identity before authorization or allocation", async () => {
    let calls = 0;
    const b = fixture(async () => {
      calls++;
    });
    try {
      for (const field of Object.keys(identity)) {
        await assertRejects(() =>
          b.hostedHttp.resolve({ ...authority, [field]: "foreign" }, new AbortController().signal)
        );
      }
      assertEquals(calls, 0);
      assertEquals(b.active, 0);
    } finally {
      await b.shutdown();
    }
  });
  it("authorization failure cannot return executable authority", async () => {
    const b = fixture(async () => {
      throw new Error("denied");
    });
    try {
      await assertRejects(
        () => b.hostedHttp.resolve(authority, new AbortController().signal),
        Error,
        "denied",
      );
      assertEquals(b.active, 0);
    } finally {
      await b.shutdown();
    }
  });
  it("orders a request by when its authorization began, not when it finished", async () => {
    let began = 0;
    const b = fixture(async () => {
      began = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    try {
      const input = await b.hostedHttp.resolve(authority, new AbortController().signal);
      const request = input.session.request;
      assertEquals(request.requestedAt <= began, true);
      // The configured lifetime still runs from the end of authorization.
      assertEquals(request.hardDeadlineAt >= began + 40 + 75_000, true);
      assertEquals(request.prepareDeadlineAt >= began + 40 + 30_000, true);
    } finally {
      await b.shutdown();
    }
  });

  it("keeps the maximum lifetime within the session bound when authorization takes time", async () => {
    const f = createHostedHttpFixture(() => new Response("A"));
    const b = createInstalledHttpBroker({
      installations: [{ image: f.input.session.expectedImage, configuration }],
      expectedBrokerInstanceId: "broker-a",
      allocator: f.input.session.allocator,
      connectTransport: f.input.session.connectTransport,
      maxActive: 2,
      requestLifetimeMs: 86_400_000,
      authorize: () => new Promise((resolve) => setTimeout(resolve, 40)),
    });
    try {
      const { request } = (await b.hostedHttp.resolve(authority, new AbortController().signal))
        .session;
      assertEquals(request.hardDeadlineAt - request.requestedAt, 86_400_000);
      assertEquals(request.prepareDeadlineAt <= request.hardDeadlineAt, true);
    } finally {
      await b.shutdown();
    }
  });

  it("captures configuration and authority before awaiting authorization", async () => {
    const wait = Promise.withResolvers<void>();
    const seen: unknown[] = [];
    const b = fixture(async (value) => {
      seen.push(value);
      await wait.promise;
    });
    const mutable = { ...authority };
    try {
      const pending = b.hostedHttp.resolve(mutable, new AbortController().signal);
      mutable.projectId = "foreign";
      wait.resolve();
      const input = await pending;
      assertEquals(input.installation.owner, { scopeKind: "project", projectId: "project-a" });
      assertEquals(input.configuration.variables, { PUBLIC_MARKER: "A" });
      assertEquals(Object.isFrozen(seen[0]), true);
      assertEquals(input.session.request.executionProfile, "http");
      assertEquals(input.session.request.source, { type: "release", releaseId: "release-a" });
      assertEquals("sourceToken" in input.configuration, false);
      assertEquals("sourceToken" in input.session.request, false);
    } finally {
      wait.resolve();
      await b.shutdown();
    }
  });
  it("does not return authority after shutdown or request cancellation", async () => {
    const b = fixture();
    const controller = new AbortController();
    controller.abort();
    await assertRejects(() => b.hostedHttp.resolve(authority, controller.signal));
    await b.shutdown();
    await assertRejects(() => b.hostedHttp.resolve(authority, new AbortController().signal));
  });
  it("refuses registry drift, duplicate identities and non-digest images at startup", () => {
    const f = createHostedHttpFixture(() => new Response("A"));
    const entry = { image: f.input.session.expectedImage, configuration };
    const options = {
      installations: [entry],
      expectedBrokerInstanceId: "broker-a",
      allocator: f.input.session.allocator,
      connectTransport: f.input.session.connectTransport,
      maxActive: 1,
      authorize: async () => {},
    };
    assertThrows(
      () => createInstalledHttpBroker({ ...options, installations: [entry, entry] }),
      TypeError,
      "Duplicate",
    );
    assertThrows(
      () =>
        createInstalledHttpBroker({
          ...options,
          installations: [{ ...entry, image: "registry.example/runtime:latest" }],
        }),
      TypeError,
      "digest pinned",
    );
    assertThrows(
      () => createInstalledHttpBroker({ ...options, expectedBrokerInstanceId: undefined as never }),
      TypeError,
      "identity",
    );
    const getter = {
      ...entry,
      get configuration(): typeof configuration {
        throw new Error("must not invoke getter");
      },
    };
    assertThrows(
      () => createInstalledHttpBroker({ ...options, installations: [getter] }),
      TypeError,
      "registry",
    );
  });
  it("cancellation during source authorization prevents executable authority", async () => {
    const wait = Promise.withResolvers<void>();
    const b = fixture(async () => {
      await wait.promise;
    });
    const controller = new AbortController();
    const pending = b.hostedHttp.resolve(authority, controller.signal);
    controller.abort();
    wait.resolve();
    try {
      await assertRejects(() => pending);
      assertEquals(b.active, 0);
    } finally {
      await b.shutdown();
    }
  });
  it("retains pending source authorization through shutdown settlement", async () => {
    const wait = Promise.withResolvers<void>();
    const b = fixture(async () => {
      await wait.promise;
    });
    const pending = b.hostedHttp.resolve(authority, new AbortController().signal);
    let settled = false;
    const retirement = b.settled.then(() => {
      settled = true;
    });
    try {
      const notice = await b.shutdown();
      await Promise.resolve();
      assertEquals(notice.pending, 1, "source authorization still owns raw work");
      assertEquals(settled, false, "shutdown notice must not certify raw settlement");
    } finally {
      wait.resolve();
      await assertRejects(() => pending);
      await retirement;
    }
    assertEquals(settled, true);
  });
});
