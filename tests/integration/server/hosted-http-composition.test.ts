import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv, withTempDir } from "#veryfront/testing";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  clearEnvFileValueSource,
  markEnvFileValue,
} from "#veryfront/platform/compat/process/env.ts";
import type { HostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-session.ts";
import type { createHostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-allocator-client.ts";
import {
  createHostedHttpComposition,
  type HostedHttpCompositionConfig,
  isHostedHttpIsolationEnabled,
  readHostedHttpCompositionConfig,
} from "#veryfront/server/isolated-http/hosted-http-composition.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";

const hostEnv: Record<string, string> = {
  VERYFRONT_HOSTED_HTTP_ISOLATION: "1",
  VERYFRONT_EXECUTOR_ALLOCATOR_URL: "https://allocator.internal.test",
  VERYFRONT_EXECUTOR_BROKER_TOKEN_FILE: "/var/run/broker/token",
  VERYFRONT_EXECUTOR_BROKER_INSTANCE_ID: "3f0c9a52-0d0f-4e4a-8a52-1d2c3b4a5f60",
  VERYFRONT_HOSTED_HTTP_SOURCE_RECORDS_FILE: "/etc/veryfront/source-records.json",
  VERYFRONT_HOSTED_HTTP_SOURCE_API_ORIGIN: "https://source-api.veryfront.test",
  VERYFRONT_HOSTED_HTTP_SOURCE_IMAGE_REPOSITORY: "ghcr.io/veryfront/tenant-source",
  VERYFRONT_HOSTED_HTTP_SERVICE_ACCOUNT_ID: "service-account-renderer",
  VERYFRONT_API_BASE_URL: "https://api.veryfront.test",
};

const read = (env: Record<string, string | undefined>) => (key: string) => env[key];

const allocator: HostedExecutorAllocatorClient = {
  allocate: () => Promise.reject(new Error("not used")),
  observe: () => Promise.reject(new Error("not used")),
  renew: () => Promise.reject(new Error("not used")),
  release: () => Promise.reject(new Error("not used")),
};

function fakeBroker() {
  let shutdowns = 0;
  return {
    broker: {
      fetch: () => Promise.resolve(new Response("isolated")),
      shutdown() {
        shutdowns++;
        return Promise.resolve({ release: "released" as const, pending: 0 });
      },
    },
    get shutdowns() {
      return shutdowns;
    },
  };
}

async function writeHostFiles(dir: string, records: unknown = [{
  schema_version: 1,
  status: "resolved",
  api_origin: "https://source-api.veryfront.test",
  project_id: PROJECT_ID,
  release_id: RELEASE_ID,
  manifest_hash: "c".repeat(64),
  image: `ghcr.io/veryfront/tenant-source@sha256:${"b".repeat(64)}`,
}]): Promise<HostedHttpCompositionConfig> {
  await Deno.writeTextFile(`${dir}/token`, "broker-token-1\n");
  await Deno.writeTextFile(`${dir}/ca.pem`, "-----BEGIN CERTIFICATE-----\nAA==\n");
  await Deno.writeTextFile(`${dir}/records.json`, JSON.stringify(records));
  return readHostedHttpCompositionConfig(read({
    ...hostEnv,
    VERYFRONT_EXECUTOR_BROKER_TOKEN_FILE: `${dir}/token`,
    VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE: `${dir}/ca.pem`,
    VERYFRONT_HOSTED_HTTP_SOURCE_RECORDS_FILE: `${dir}/records.json`,
  }))!;
}

describe("hosted HTTP host composition", () => {
  it("refuses to start while the shared host execution override is set", async () => {
    await withTempDir(async (dir) => {
      const config = await writeHostFiles(dir);
      let built = 0;
      await withEnv({ VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION: "1" }, async () => {
        await assertRejects(
          () =>
            createHostedHttpComposition(config, {
              createAllocatorClient: () => {
                built++;
                return allocator;
              },
              createBroker: () => fakeBroker().broker,
            }),
          TypeError,
          "host project execution",
        );
      });
      assertEquals(built, 0);
    });
  });

  it("builds the allocator client from host files and rereads the rotated broker token", async () => {
    await withTempDir(async (dir) => {
      const config = await writeHostFiles(dir);
      let allocatorOptions: Parameters<typeof createHostedExecutorAllocatorClient>[0] | undefined;
      let brokerOptions: unknown;
      const broker = fakeBroker();
      const composition = await createHostedHttpComposition(config, {
        createAllocatorClient(options) {
          allocatorOptions = options;
          return allocator;
        },
        createBroker(options) {
          brokerOptions = options;
          return broker.broker;
        },
      });
      assertEquals(allocatorOptions?.baseUrl, "https://allocator.internal.test");
      assertEquals(allocatorOptions?.ca, "-----BEGIN CERTIFICATE-----\nAA==\n");
      assertEquals(brokerOptions, { maxActive: 16 });
      const signal = new AbortController().signal;
      assertEquals(await allocatorOptions!.readBrokerToken(signal), "broker-token-1");
      await Deno.writeTextFile(`${dir}/token`, "broker-token-2");
      assertEquals(await allocatorOptions!.readBrokerToken(signal), "broker-token-2");
      await Deno.writeTextFile(`${dir}/token`, "");
      await assertRejects(() => allocatorOptions!.readBrokerToken(signal));
      assert(composition.ingress.broker === broker.broker);
      await composition.shutdown();
    });
  });

  it("refuses an unpublished release without dispatching to the broker", async () => {
    await withTempDir(async (dir) => {
      const config = await writeHostFiles(dir);
      const composition = await createHostedHttpComposition(config, {
        createAllocatorClient: () => allocator,
        createBroker: () => fakeBroker().broker,
      });
      await withMockFetch(
        () => Promise.resolve(new Response("{}", { status: 403 })),
        () =>
          assertRejects(() =>
            composition.ingress.resolve({
              projectId: PROJECT_ID,
              projectSlug: "project-a",
              releaseId: "33333333-3333-4333-8333-333333333333",
              environmentId: "environment-a",
              environmentName: "production",
              sourceToken: "source-token",
            }, new AbortController().signal)
          ),
      );
      await composition.shutdown();
    });
  });

  it("ignores the isolation flag when it comes from a project env file", async () => {
    await withEnv({ VERYFRONT_HOSTED_HTTP_ISOLATION: "1" }, () => {
      assertEquals(isHostedHttpIsolationEnabled(), true);
      markEnvFileValue("VERYFRONT_HOSTED_HTTP_ISOLATION");
      try {
        assertEquals(isHostedHttpIsolationEnabled(), false);
        assertEquals(readHostedHttpCompositionConfig(), undefined);
      } finally {
        clearEnvFileValueSource("VERYFRONT_HOSTED_HTTP_ISOLATION");
      }
      return Promise.resolve();
    });
  });
});
