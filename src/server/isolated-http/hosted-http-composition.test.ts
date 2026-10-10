import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-session.ts";
import type { createHostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-allocator-client.ts";
import {
  createHostedHttpComposition,
  createRefreshingSourceRecordLookup,
  isHostedHttpIsolationEnabled,
  readHostedHttpCompositionConfig,
  settleWithin,
} from "./hosted-http-composition.ts";

const hostEnv: Record<string, string | undefined> = {
  VERYFRONT_HOSTED_HTTP_ISOLATION: "1",
  VERYFRONT_EXECUTOR_ALLOCATOR_URL: "https://allocator.internal.test",
  VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE: "/host/ca.pem",
  VERYFRONT_EXECUTOR_BROKER_TOKEN_FILE: "/host/token",
  VERYFRONT_EXECUTOR_BROKER_INSTANCE_ID: "3f0c9a52-0d0f-4e4a-8a52-1d2c3b4a5f60",
  VERYFRONT_HOSTED_HTTP_SOURCE_RECORDS_FILE: "/host/records.json",
  VERYFRONT_HOSTED_HTTP_SOURCE_API_ORIGIN: "https://source-api.veryfront.test",
  VERYFRONT_HOSTED_HTTP_SOURCE_IMAGE_REPOSITORY: "ghcr.io/veryfront/tenant-source",
  VERYFRONT_HOSTED_HTTP_SERVICE_ACCOUNT_ID: "service-account-renderer",
  VERYFRONT_API_BASE_URL: "https://api.veryfront.test",
};
const read = (env: Record<string, string | undefined>) => (key: string) => env[key];
const config = readHostedHttpCompositionConfig(read(hostEnv))!;
const record = {
  schema_version: 1,
  status: "resolved",
  api_origin: "https://source-api.veryfront.test",
  project_id: "11111111-1111-4111-8111-111111111111",
  release_id: "22222222-2222-4222-8222-222222222222",
  manifest_hash: "c".repeat(64),
  image: `ghcr.io/veryfront/tenant-source@sha256:${"b".repeat(64)}`,
};

const nodeRuntime = () => ({ supported: true, name: "Node.js 22.0.0" });

const allocator: HostedExecutorAllocatorClient = {
  allocate: () => Promise.reject(new Error("not used")),
  observe: () => Promise.reject(new Error("not used")),
  renew: () => Promise.reject(new Error("not used")),
  release: () => Promise.reject(new Error("not used")),
};

/** In-memory host files; a missing path rejects like the real reader. */
function hostFiles(initial: Record<string, string | Uint8Array>) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile(path: string) {
      const value = files.get(path);
      if (value === undefined) return Promise.reject(new Error(`ENOENT ${path}`));
      return Promise.resolve(typeof value === "string" ? new TextEncoder().encode(value) : value);
    },
  };
}

function defaultFiles() {
  return hostFiles({
    "/host/ca.pem": "-----BEGIN CERTIFICATE-----\nAA==\n",
    "/host/token": "broker-token-1\n",
    "/host/records.json": JSON.stringify([record]),
  });
}

function fakeBroker(result: { release: "released" | "reaper-required"; pending: number }) {
  let shutdowns = 0;
  return {
    broker: {
      fetch: () => Promise.resolve(new Response("isolated")),
      shutdown() {
        shutdowns++;
        return Promise.resolve(result);
      },
    },
    get shutdowns() {
      return shutdowns;
    },
  };
}

describe("hosted HTTP host composition", () => {
  it("is off unless the host flag enables it", () => {
    assertEquals(readHostedHttpCompositionConfig(read({})), undefined);
    for (const value of ["", "0", "false", "off", "no", " OFF "]) {
      assertEquals(
        readHostedHttpCompositionConfig(read({ VERYFRONT_HOSTED_HTTP_ISOLATION: value })),
        undefined,
      );
    }
  });

  it("refuses an unrecognized flag or an incomplete host configuration", () => {
    assertThrows(
      () =>
        readHostedHttpCompositionConfig(
          read({ ...hostEnv, VERYFRONT_HOSTED_HTTP_ISOLATION: "maybe" }),
        ),
      TypeError,
    );
    for (
      const key of Object.keys(hostEnv).filter((key) =>
        key !== "VERYFRONT_HOSTED_HTTP_ISOLATION" && key !== "VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE"
      )
    ) {
      assertThrows(
        () => readHostedHttpCompositionConfig(read({ ...hostEnv, [key]: undefined })),
        TypeError,
        key,
      );
    }
    for (
      const invalid of [
        { VERYFRONT_EXECUTOR_ALLOCATOR_URL: "http://allocator.internal.test" },
        { VERYFRONT_EXECUTOR_BROKER_INSTANCE_ID: "../pod" },
        { VERYFRONT_HOSTED_HTTP_MAX_ACTIVE: "0" },
        { VERYFRONT_HOSTED_HTTP_MAX_ACTIVE: "257" },
        { VERYFRONT_HOSTED_HTTP_MAX_ACTIVE: "1.5" },
        { VERYFRONT_EXECUTOR_BROKER_TOKEN_FILE: "relative/token" },
        { VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE: "ca.pem" },
      ]
    ) {
      assertThrows(
        () => readHostedHttpCompositionConfig(read({ ...hostEnv, ...invalid })),
        TypeError,
      );
    }
  });

  it("reads the host configuration with a bounded default admission limit", () => {
    assertEquals(config.maxActive, 16);
    assertEquals(config.allocatorCaFile, "/host/ca.pem");
    const withoutCa = readHostedHttpCompositionConfig(
      read({ ...hostEnv, VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE: undefined }),
    )!;
    assertEquals("allocatorCaFile" in withoutCa, false);
    assertEquals(
      readHostedHttpCompositionConfig(read({ ...hostEnv, VERYFRONT_HOSTED_HTTP_MAX_ACTIVE: "64" }))!
        .maxActive,
      64,
    );
    assert(Object.isFrozen(config));
  });

  it("refuses to start while the shared host execution override is set", async () => {
    let built = 0;
    await assertRejects(
      () =>
        createHostedHttpComposition(config, {
          runtime: nodeRuntime,
          isOverrideEnabled: () => true,
          readFile: defaultFiles().readFile,
          createAllocatorClient: () => {
            built++;
            return allocator;
          },
          createBroker: () => fakeBroker({ release: "released", pending: 0 }).broker,
        }),
      TypeError,
      "host project execution",
    );
    assertEquals(built, 0);
  });

  it("builds the allocator client from host files and rereads the rotated broker token", async () => {
    const host = defaultFiles();
    let allocatorOptions: Parameters<typeof createHostedExecutorAllocatorClient>[0] | undefined;
    let brokerOptions: unknown;
    const broker = fakeBroker({ release: "released", pending: 0 });
    const composition = await createHostedHttpComposition(config, {
      runtime: nodeRuntime,
      isOverrideEnabled: () => false,
      readFile: host.readFile,
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
    assertEquals(brokerOptions, { maxActive: 16, shutdownTimeoutMs: 3_000 });
    const signal = new AbortController().signal;
    assertEquals(await allocatorOptions!.readBrokerToken(signal), "broker-token-1");
    host.files.set("/host/token", "broker-token-2");
    assertEquals(await allocatorOptions!.readBrokerToken(signal), "broker-token-2");
    host.files.set("/host/token", " \n");
    await assertRejects(() => allocatorOptions!.readBrokerToken(signal));
    host.files.set("/host/token", "x".repeat(16 * 1024 + 1));
    await assertRejects(
      () => allocatorOptions!.readBrokerToken(signal),
      Error,
      "The file named by VERYFRONT_EXECUTOR_BROKER_TOKEN_FILE is too large",
    );
    assert(composition.ingress.broker === broker.broker);
    assertEquals(composition.ingress.maxPreparing, 16);
    assertEquals(typeof composition.ingress.resolve, "function");
    await composition.shutdown();
  });

  it("omits the trust root when no CA file is configured", async () => {
    let ca: string | undefined = "unset";
    await createHostedHttpComposition({ ...config, allocatorCaFile: undefined }, {
      runtime: nodeRuntime,
      isOverrideEnabled: () => false,
      readFile: defaultFiles().readFile,
      createAllocatorClient(options) {
        ca = options.ca;
        return allocator;
      },
      createBroker: () => fakeBroker({ release: "released", pending: 0 }).broker,
    });
    assertEquals(ca, undefined);
  });

  it("refuses unreadable, invalid or undecodable host files at startup", async () => {
    const cases: Record<string, string | Uint8Array>[] = [
      { "/host/ca.pem": "ca", "/host/token": "t" },
      { "/host/ca.pem": "ca", "/host/records.json": "{not json" },
      { "/host/ca.pem": "ca", "/host/records.json": JSON.stringify([{ project_id: "p" }]) },
      { "/host/ca.pem": "ca", "/host/records.json": new Uint8Array([0xff, 0xfe]) },
      { "/host/ca.pem": "x".repeat(256 * 1024 + 1), "/host/records.json": "[]" },
    ];
    for (const files of cases) {
      await assertRejects(() =>
        createHostedHttpComposition(config, {
          runtime: nodeRuntime,
          isOverrideEnabled: () => false,
          readFile: hostFiles(files).readFile,
          createAllocatorClient: () => allocator,
          createBroker: () => fakeBroker({ release: "released", pending: 0 }).broker,
        })
      );
    }
  });

  it("shuts the broker down once, however often the server stops", async () => {
    for (
      const result of [
        { release: "released" as const, pending: 0 },
        { release: "reaper-required" as const, pending: 1 },
      ]
    ) {
      const broker = fakeBroker(result);
      const composition = await createHostedHttpComposition(config, {
        runtime: nodeRuntime,
        isOverrideEnabled: () => false,
        readFile: defaultFiles().readFile,
        createAllocatorClient: () => allocator,
        createBroker: () => broker.broker,
      });
      await Promise.all([composition.shutdown(), composition.shutdown()]);
      await composition.shutdown();
      assertEquals(broker.shutdowns, 1);
    }
  });

  it("throws on an unrecognized flag value from the host reader", () => {
    assertEquals(
      isHostedHttpIsolationEnabled(read({ VERYFRONT_HOSTED_HTTP_ISOLATION: "on" })),
      true,
    );
    assertThrows(
      () => isHostedHttpIsolationEnabled(read({ VERYFRONT_HOSTED_HTTP_ISOLATION: "enabled" })),
      TypeError,
    );
  });

  it("rereads source records after the refresh interval and fails closed on a broken file", async () => {
    let clock = 0;
    let text = JSON.stringify([record]);
    let reads = 0;
    const other = {
      ...record,
      release_id: "33333333-3333-4333-8333-333333333333",
      image: `ghcr.io/veryfront/tenant-source@sha256:${"e".repeat(64)}`,
    };
    const lookup = await createRefreshingSourceRecordLookup({
      readText: () => {
        reads++;
        return Promise.resolve(text);
      },
      now: () => clock,
      refreshMs: 60_000,
      readTimeoutMs: 5_000,
    });
    const signal = new AbortController().signal;
    const first = { projectId: record.project_id, releaseId: record.release_id };
    const second = { projectId: other.project_id, releaseId: other.release_id };
    assertEquals(((await lookup(first, signal)) as { image: string }).image, record.image);

    text = JSON.stringify([record, other]);
    clock = 59_999;
    await assertRejects(() => lookup(second, signal));
    clock = 60_000;
    assertEquals(((await lookup(second, signal)) as { image: string }).image, other.image);
    assertEquals(reads, 2);

    text = "{broken";
    clock = 120_000;
    await assertRejects(() => lookup(first, signal), Error, "Source records are unavailable");
    clock = 130_000;
    await assertRejects(() => lookup(first, signal));
    text = JSON.stringify([record]);
    clock = 180_000;
    assertEquals(((await lookup(first, signal)) as { image: string }).image, record.image);
  });

  it("reads the source records file once for concurrent refreshes", async () => {
    let clock = 0;
    let reads = 0;
    const lookup = await createRefreshingSourceRecordLookup({
      readText: () => {
        reads++;
        return Promise.resolve(JSON.stringify([record]));
      },
      now: () => clock,
      refreshMs: 1_000,
      readTimeoutMs: 5_000,
    });
    clock = 5_000;
    const signal = new AbortController().signal;
    const request = { projectId: record.project_id, releaseId: record.release_id };
    await Promise.all([lookup(request, signal), lookup(request, signal), lookup(request, signal)]);
    assertEquals(reads, 2);
  });

  it("refuses to start on a runtime without the Node.js transport", async () => {
    let built = 0;
    await assertRejects(
      () =>
        createHostedHttpComposition(config, {
          runtime: () => ({ supported: false, name: "the compiled Deno binary" }),
          isOverrideEnabled: () => false,
          readFile: defaultFiles().readFile,
          createAllocatorClient: () => {
            built++;
            return allocator;
          },
          createBroker: () => fakeBroker({ release: "released", pending: 0 }).broker,
        }),
      TypeError,
      "VERYFRONT_HOSTED_HTTP_ISOLATION requires Node.js 22 or newer and is unsupported on the compiled Deno binary",
    );
    assertEquals(built, 0);
  });

  it("refuses releases while a source records read stalls, then retries", async () => {
    let clock = 0;
    let stall = false;
    let aborts = 0;
    const lookup = await createRefreshingSourceRecordLookup({
      readText: (readSignal) => {
        if (!stall) return Promise.resolve(JSON.stringify([record]));
        readSignal.addEventListener("abort", () => aborts++, { once: true });
        return new Promise(() => {}); // never settles, even after abort
      },
      now: () => clock,
      refreshMs: 1_000,
      readTimeoutMs: 20,
    });
    const signal = new AbortController().signal;
    const request = { projectId: record.project_id, releaseId: record.release_id };
    stall = true;
    clock = 1_000;
    await assertRejects(() => lookup(request, signal), Error, "Source records are unavailable");
    assertEquals(aborts, 1);
    stall = false;
    clock = 2_000;
    assertEquals(((await lookup(request, signal)) as { image: string }).image, record.image);
  });

  it("reports unreadable host files by setting name, never by path", async () => {
    const error = await assertRejects(() =>
      createHostedHttpComposition(config, {
        runtime: nodeRuntime,
        isOverrideEnabled: () => false,
        readFile: hostFiles({ "/host/records.json": JSON.stringify([record]) }).readFile,
        createAllocatorClient: () => allocator,
        createBroker: () => fakeBroker({ release: "released", pending: 0 }).broker,
      })
    );
    assert(error instanceof Error);
    assertEquals(
      error.message.includes("VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE could not be read"),
      true,
      error.message,
    );
    assertEquals(error.message.includes("/host/"), false);
    assertEquals(String((error as { cause?: unknown }).cause ?? "").includes("/host/"), false);
  });

  it("detaches a broker token read that never settles", async () => {
    let allocatorOptions: Parameters<typeof createHostedExecutorAllocatorClient>[0] | undefined;
    const host = defaultFiles();
    let stall = false;
    await createHostedHttpComposition(config, {
      runtime: nodeRuntime,
      isOverrideEnabled: () => false,
      readFile: (path) =>
        stall && path === "/host/token" ? new Promise(() => {}) : host.readFile(path),
      createAllocatorClient(options) {
        allocatorOptions = options;
        return allocator;
      },
      createBroker: () => fakeBroker({ release: "released", pending: 0 }).broker,
    });
    stall = true;
    const controller = new AbortController();
    const pending = allocatorOptions!.readBrokerToken(controller.signal);
    controller.abort(new Error("allocator deadline"));
    await assertRejects(() => pending, Error, "allocator deadline");
    await assertRejects(
      () => settleWithin(new Promise(() => {}), new AbortController().signal, 10),
      Error,
      "timed out",
    );
  });

  it("refuses to start when the CA file read stalls", async () => {
    const host = defaultFiles();
    await assertRejects(
      () =>
        createHostedHttpComposition(config, {
          runtime: nodeRuntime,
          isOverrideEnabled: () => false,
          hostFileReadTimeoutMs: 10,
          readFile: (path) => path === "/host/ca.pem" ? new Promise(() => {}) : host.readFile(path),
          createAllocatorClient: () => allocator,
          createBroker: () => fakeBroker({ release: "released", pending: 0 }).broker,
        }),
      Error,
      "VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE could not be read in time",
    );
  });
});
