import { assertEquals } from "#veryfront/testing/assert.ts";
import { createInstalledProjectAgentSessionResolver } from "./index.ts";

Deno.test("installed agent session entrypoint decodes its registry without extension bootstrap or IO", () => {
  const unavailable = async () => {
    throw new Error("Registry decoding must not perform IO");
  };
  const resolve = createInstalledProjectAgentSessionResolver({
    installations: [{
      image: `ghcr.io/veryfront/tenant-source@sha256:${"a".repeat(64)}`,
      configuration: {
        projectId: "00000000-0000-4000-8000-000000000099",
        projectSlug: "private-source",
        environmentId: "00000000-0000-4000-8000-000000000098",
        environmentName: "production",
        releaseId: "release-1",
        configurationId: "config-1",
        variables: {},
      },
    }],
    expectedBrokerInstanceId: "broker-a",
    allocator: {
      allocate: unavailable,
      observe: unavailable,
      renew: unavailable,
      release: unavailable,
    },
    connectTransport: unavailable,
  });
  assertEquals(typeof resolve, "function");
});
