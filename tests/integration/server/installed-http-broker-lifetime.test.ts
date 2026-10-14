import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedHttpFixture } from "../../fixtures/hosted-http-broker.ts";
import { createInstalledHttpBroker } from "#veryfront/server/isolated-http/installed-http-broker.ts";

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

// The controlled host clock belongs in the integration suite, not unit tests.
describe("installed HTTP broker request lifetime", () => {
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
});
