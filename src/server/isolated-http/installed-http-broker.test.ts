import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedHttpFixture } from "../../../tests/fixtures/hosted-http-broker.ts";
import type { HostedHttpRequestAuthority } from "./hosted-http-ingress.ts";
import {
  createInstalledHttpBroker,
  type InstalledHttpBrokerOptions,
} from "./installed-http-broker.ts";

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
  it("uses the configured bounded lifetime for long requests and streams", async () => {
    const f = createHostedHttpFixture(() => new Response("A"));
    let attachments = 0;
    const observeAttachment = () => {
      attachments++;
    };
    const options = {
      installations: [{ image: f.input.session.expectedImage, configuration }],
      expectedBrokerInstanceId: "broker-a",
      allocator: f.input.session.allocator,
      connectTransport: f.input.session.connectTransport,
      observeAttachment,
      maxActive: 1,
      authorize: async () => {},
      requestLifetimeMs: 180_000,
    };
    const b = createInstalledHttpBroker(options);
    try {
      const startedAt = Date.now();
      const input = await b.hostedHttp.resolve(authority, new AbortController().signal);
      assertEquals(input.session.observeAttachment, observeAttachment);
      assertEquals(attachments, 0);
      const finishedAt = Date.now();
      const { hardDeadlineAt, prepareDeadlineAt } = input.session.request;
      // Lifetimes start after authorization, which can cross a clock tick.
      assertEquals(hardDeadlineAt >= startedAt + 180_000, true);
      assertEquals(hardDeadlineAt <= finishedAt + 180_000, true);
      assertEquals(prepareDeadlineAt >= startedAt + 30_000, true);
      assertEquals(prepareDeadlineAt <= finishedAt + 30_000, true);
    } finally {
      await b.shutdown();
    }
    for (const requestLifetimeMs of [0, -1, NaN, Infinity, 1.5, 86_400_001]) {
      assertThrows(() => createInstalledHttpBroker({ ...options, requestLifetimeMs }), TypeError);
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
    using time = new FakeTime(1_000_000);
    const authorized = Promise.withResolvers<void>();
    const b = fixture(() => authorized.promise);
    try {
      const pending = b.hostedHttp.resolve(authority, new AbortController().signal);
      time.tick(40);
      authorized.resolve();
      const { request } = (await pending).session;
      assertEquals(request.requestedAt, 1_000_000);
      assertEquals(request.hardDeadlineAt, 1_000_040 + 75_000);
      assertEquals(request.prepareDeadlineAt, 1_000_040 + 30_000);
    } finally {
      await b.shutdown();
    }
  });

  it("keeps the maximum lifetime within the session bound when authorization takes time", async () => {
    using time = new FakeTime(1_000_000);
    const authorized = Promise.withResolvers<void>();
    const f = createHostedHttpFixture(() => new Response("A"));
    const b = createInstalledHttpBroker({
      installations: [{ image: f.input.session.expectedImage, configuration }],
      expectedBrokerInstanceId: "broker-a",
      allocator: f.input.session.allocator,
      connectTransport: f.input.session.connectTransport,
      maxActive: 2,
      requestLifetimeMs: 86_400_000,
      authorize: () => authorized.promise,
    });
    try {
      const pending = b.hostedHttp.resolve(authority, new AbortController().signal);
      time.tick(40);
      authorized.resolve();
      const { request } = (await pending).session;
      assertEquals(request.requestedAt, 1_000_000);
      assertEquals(request.hardDeadlineAt, 1_000_000 + 86_400_000);
      assertEquals(request.prepareDeadlineAt, 1_000_040 + 30_000);
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

describe("captured HTTP configuration profile", () => {
  const base = {
    projectId: "10000000-1000-4000-8000-100000000001",
    projectSlug: "captured",
    environmentId: "20000000-2000-4000-8000-200000000002",
    environmentName: "production",
    releaseId: "30000000-3000-4000-8000-300000000003",
  };
  const a = {
    version: 1 as const,
    projectId: base.projectId,
    environmentId: base.environmentId,
    releaseId: base.releaseId,
    deploymentId: "40000000-4000-4000-8000-400000000004",
    configurationId:
      "configuration-977ea9cbd72ac8d4865b7816bab22733a0d47caa9d79e0bcedbbfff120af41e1",
  };
  const b = {
    ...a,
    deploymentId: "50000000-5000-4000-8000-500000000005",
    configurationId:
      "configuration-6c8979e0beaf75caa3d21174691b651598bf6e772a48c138302d7cb8c98312cb",
  };
  function create(select: InstalledHttpBrokerOptions["authorize"], legacy = false) {
    const f = createHostedHttpFixture(() => new Response("unused"));
    return createInstalledHttpBroker({
      expectedBrokerInstanceId: "broker-a",
      maxActive: 2,
      allocator: f.input.session.allocator,
      connectTransport: f.input.session.connectTransport,
      installations: (legacy ? [a] : [a, b]).map((ref, index) => ({
        image: f.input.session.expectedImage,
        configuration: {
          ...base,
          configurationId: ref.configurationId,
          variables: { SETTING: index ? "B" : "A" },
        },
      })),
      ...(legacy ? {} : { configurationReferences: { version: 1 as const, references: [a, b] } }),
      authorize: select,
    });
  }
  it("selects authenticated new deployment B while captured A remains unchanged and restart-resolvable", async () => {
    let selected = a;
    const broker = create(async () => selected);
    const authority = { ...base, sourceToken: "private-source-token" };
    try {
      const old = await broker.hostedHttp.resolve(authority, new AbortController().signal);
      selected = b;
      const next = await broker.hostedHttp.resolve(authority, new AbortController().signal);
      assertEquals(old.configuration?.variables.SETTING, "A");
      assertEquals(next.configuration?.variables.SETTING, "B");
      assertEquals(next.installation.configurationId, b.configurationId);
      const restarted = create(async () => JSON.parse(JSON.stringify(a)));
      try {
        assertEquals(
          (await restarted.hostedHttp.resolve(authority, new AbortController().signal))
            .configuration?.variables.SETTING,
          "A",
        );
      } finally {
        await restarted.shutdown();
      }
    } finally {
      await broker.shutdown();
    }
  });
  it("refuses missing/foreign host references, legacy reference use and browser selector overrides", async () => {
    const authority = { ...base, sourceToken: "private-source-token" };
    for (
      const [reference, legacy] of [[undefined, false], [{
        ...a,
        deploymentId: "90000000-9000-4000-8000-900000000009",
      }, false], [a, true]] as const
    ) {
      const broker = create(async () => reference, legacy);
      try {
        await assertRejects(() =>
          broker.hostedHttp.resolve(authority, new AbortController().signal)
        );
      } finally {
        await broker.shutdown();
      }
    }
    const broker = create(async () => b);
    try {
      await assertRejects(() =>
        broker.hostedHttp.resolve(
          { ...authority, runtimeConfiguration: a } as never,
          new AbortController().signal,
        )
      );
    } finally {
      await broker.shutdown();
    }
  });
});
