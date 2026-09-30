import { startProductionServer } from "#veryfront/server/production-server.ts";
import type { BootstrapResult } from "#veryfront/server/bootstrap.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { createVeryfrontHandler } from "#veryfront/server/runtime-handler/index.ts";
import { createHostedHttpBroker } from "veryfront/server/http-broker";
import { createHostedHttpFixture } from "../../fixtures/hosted-http-broker.ts";

const identity = {
  projectId: "project-a",
  projectSlug: "project-a",
  releaseId: "release-a",
  environmentId: "environment-a",
  environmentName: "staging",
};

it("dispatches trusted production HTTP before host project reads and preserves its public origin and body", async () => {
  await withEnv({ VERYFRONT_TRUST_FORWARDED_HEADERS: "1" }, async () => {
    await withMockFetch(() => {
      throw new Error("Unexpected host network request");
    }, async () => {
      const adapter = createMockAdapter();
      let hostReads = 0;
      adapter.fs.readFile = () => {
        hostReads++;
        throw new Error("Host project read");
      };
      let resolutions = 0;
      const fixture = createHostedHttpFixture(async (request) => {
        assertEquals(request.url, "https://app.example/api/proof?query=1");
        assertEquals(request.headers.get("host"), "app.example");
        assertEquals(request.headers.get("authorization"), "Bearer application");
        assertEquals(request.headers.get("x-token"), null);
        assertEquals(request.headers.get("x-environment-name"), null);
        assertEquals(request.headers.get("x-forwarded-host"), null);
        assertEquals(request.method, "POST");
        return new Response(request.body, {
          status: 201,
          headers: { "content-type": "application/octet-stream" },
        });
      });
      const broker = createHostedHttpBroker({ maxActive: 1 });
      const handler = createVeryfrontHandler("/host", adapter, {
        projectDir: "/host",
        config: { fs: { veryfront: { proxyMode: true } } },
        hostedHttp: {
          broker,
          resolve(authority: typeof identity & { sourceToken: string }) {
            resolutions++;
            assertEquals(authority, { ...identity, sourceToken: "source-only" });
            return Promise.resolve({
              ...fixture.input,
              configuration: {
                ...identity,
                configurationId: "config-a",
                variables: {},
              },
            });
          },
        },
      });
      try {
        const payload = new Uint8Array(40_000).fill(137);
        const response = await handler(
          new Request("http://runtime.example/api/proof?query=1", {
            method: "POST",
            body: payload,
            headers: {
              host: "runtime.example",
              "x-forwarded-host": "app.example",
              "x-forwarded-proto": "https",
              "x-project-id": identity.projectId,
              "x-project-slug": identity.projectSlug,
              "x-release-id": identity.releaseId,
              "x-environment": "production",
              "x-environment-id": identity.environmentId,
              "x-environment-name": identity.environmentName,
              "x-token": "source-only",
              authorization: "Bearer application",
            },
          }),
        );
        assertEquals(resolutions, 1);
        assertEquals(response.status, 201);
        assertEquals(new Uint8Array(await response.arrayBuffer()), payload);
        assertEquals(hostReads, 0);
      } finally {
        await broker.shutdown();
        await broker.settled;
      }
    });
  });
});

it("keeps request cancellation connected after hosted response headers arrive", async () => {
  await withEnv({ VERYFRONT_TRUST_FORWARDED_HEADERS: "1" }, async () => {
    const adapter = createMockAdapter();
    let resolvedSignal: AbortSignal | undefined;
    const fixture = createHostedHttpFixture(() =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("prefix"));
          },
        }, { highWaterMark: 0 }),
      )
    );
    const broker = createHostedHttpBroker({ maxActive: 1 });
    const handler = createVeryfrontHandler("/host", adapter, {
      projectDir: "/host",
      config: { fs: { veryfront: { proxyMode: true } } },
      hostedHttp: {
        broker,
        resolve(_authority, signal) {
          resolvedSignal = signal;
          return Promise.resolve({
            ...fixture.input,
            configuration: { ...identity, configurationId: "config-a", variables: {} },
          });
        },
      },
    });
    const abort = new AbortController();
    try {
      const response = await handler(
        new Request("https://app.example/api/stream", {
          signal: abort.signal,
          headers: {
            "x-project-id": identity.projectId,
            "x-project-slug": identity.projectSlug,
            "x-release-id": identity.releaseId,
            "x-environment": "production",
            "x-environment-id": identity.environmentId,
            "x-environment-name": identity.environmentName,
            "x-token": "source-only",
          },
        }),
      );
      const reader = response.body!.getReader();
      assertEquals(new TextDecoder().decode((await reader.read()).value), "prefix");
      const pending = reader.read();
      void pending.catch(() => {});
      abort.abort(new Error("Client disconnected"));
      assertEquals(resolvedSignal?.aborted, true);
      await assertRejects(() => pending, Error, "Client disconnected");
      assertEquals(fixture.calls.includes("release:completed"), false);
    } finally {
      abort.abort();
      await broker.shutdown();
      await broker.settled;
    }
  });
});

it("threads hosted ingress through production startup without host discovery or CSS prewarming", async () => {
  await withEnv({
    VERYFRONT_TRUST_FORWARDED_HEADERS: "1",
    VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION: "0",
  }, async () => {
    const adapter = createMockAdapter();
    let receive: Parameters<typeof adapter.serve>[0] | undefined;
    let hostReads = 0;
    adapter.fs.readFile = () => {
      hostReads++;
      throw new Error("Host project read");
    };
    adapter.fs.readDir = () => {
      hostReads++;
      throw new Error("Host directory read");
    };
    adapter.serve = (handler, options) => {
      receive = handler;
      const addr = { hostname: "127.0.0.1", port: 3000 };
      options.onListen?.(addr);
      return Promise.resolve({ addr, stop: () => Promise.resolve() });
    };
    const fixture = createHostedHttpFixture(() => new Response("unused"));
    let resolutions = 0;
    const server = await startProductionServer({
      projectDir: "/host",
      port: 3000,
      adapter,
      unhandledRejectionGuard: false,
      defaultProjectId: identity.projectId,
      defaultProjectSlug: identity.projectSlug,
      defaultEnvironment: "production",
      bootstrapResult: {
        adapter,
        config: { fs: { veryfront: { proxyMode: true } } },
        usingFSAdapter: false,
        fsAdapterType: "MockRuntimeAdapter",
        extensionLoader: {} as BootstrapResult["extensionLoader"],
      },
      hostedHttp: {
        broker: { fetch: () => Promise.resolve(new Response("executor response")) },
        resolve() {
          resolutions++;
          return Promise.resolve({
            ...fixture.input,
            configuration: { ...identity, configurationId: "config-a", variables: {} },
          });
        },
      },
    });
    try {
      await server.ready;
      assertExists(receive);
      const response = await receive(
        new Request("https://app.example/api/proof", {
          headers: {
            "x-project-id": identity.projectId,
            "x-project-slug": identity.projectSlug,
            "x-release-id": identity.releaseId,
            "x-environment": "production",
            "x-environment-id": identity.environmentId,
            "x-environment-name": identity.environmentName,
            "x-token": "source-only",
          },
        }),
      );
      assertEquals(await response.text(), "executor response");
      assertEquals(resolutions, 1);
      assertEquals(hostReads, 0);
      const probe = await receive(new Request("https://runtime.example/healthz"));
      assertEquals(probe.status, 200);
      await probe.body?.cancel();
      assertEquals(resolutions, 1);
    } finally {
      await server.stop();
    }
  });
});

it("refuses untrusted or incomplete request authority before hosted lookup or project reads", async () => {
  for (const trusted of ["0", "1"]) {
    await withEnv({ VERYFRONT_TRUST_FORWARDED_HEADERS: trusted }, async () => {
      const adapter = createMockAdapter();
      let hostReads = 0;
      let resolutions = 0;
      adapter.fs.readFile = () => {
        hostReads++;
        throw new Error("Host project read");
      };
      const fixture = createHostedHttpFixture(() => new Response("unused"));
      const handler = createVeryfrontHandler("/host", adapter, {
        projectDir: "/host",
        config: { fs: { veryfront: { proxyMode: true } } },
        hostedHttp: {
          broker: {
            fetch() {
              throw new Error("Must not dispatch");
            },
          },
          resolve() {
            resolutions++;
            return Promise.resolve({
              ...fixture.input,
              configuration: { ...identity, configurationId: "config-a", variables: {} },
            });
          },
        },
      });
      const response = await handler(
        new Request("https://app.example/api/proof", {
          headers: {
            "x-project-id": identity.projectId,
            "x-project-slug": identity.projectSlug,
            "x-environment": "production",
            "x-token": "source-only",
            "x-environment-id": identity.environmentId,
            "x-environment-name": identity.environmentName,
          },
        }),
      );
      assertEquals(response.status, trusted === "0" ? 502 : 503);
      await response.body?.cancel();
      assertEquals(resolutions, 0);
      assertEquals(hostReads, 0);
    });
  }
});

it("rejects hosted ingress combined with local or granted host execution before project reads", () => {
  const adapter = createMockAdapter();
  let hostReads = 0;
  adapter.fs.readFile = () => {
    hostReads++;
    throw new Error("Host project read");
  };
  const hostedHttp = {
    broker: {
      fetch() {
        throw new Error("Must not dispatch");
      },
    },
    resolve() {
      throw new Error("Must not resolve");
    },
  };
  for (
    const options of [
      { config: {} },
      { config: { fs: { veryfront: { proxyMode: true } } }, allowHostProjectCodeExecution: true },
      { config: { fs: { veryfront: { proxyMode: true } } }, localProjects: { tenant: "/tenant" } },
    ]
  ) {
    assertThrows(
      () =>
        createVeryfrontHandler("/host", adapter, { projectDir: "/host", hostedHttp, ...options }),
      TypeError,
    );
  }
  assertEquals(hostReads, 0);
});

it("refuses incompatible production startup before discovery, prewarming or listening", async () => {
  for (const scenario of ["local", "granted", "mapped", "discovery"]) {
    await withEnv({
      VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION: scenario === "granted" ? "1" : "0",
    }, async () => {
      const adapter = createMockAdapter();
      let hostReads = 0;
      let listens = 0;
      adapter.fs.readFile = () => {
        hostReads++;
        throw new Error("Host project read");
      };
      adapter.fs.readDir = () => {
        hostReads++;
        throw new Error("Host directory read");
      };
      adapter.serve = () => {
        listens++;
        throw new Error("Must not listen");
      };
      await assertRejects(
        () =>
          startProductionServer({
            projectDir: "/host",
            port: 3000,
            adapter,
            unhandledRejectionGuard: false,
            defaultEnvironment: "production",
            defaultProjectId: "project-a",
            localProjects: scenario === "mapped" ? { tenant: "/tenant" } : undefined,
            discoveryConfig: scenario === "discovery" ? { baseDir: "/tenant" } : undefined,
            bootstrapResult: {
              adapter,
              config: { fs: { veryfront: { proxyMode: scenario !== "local" } } },
              usingFSAdapter: false,
              fsAdapterType: "MockRuntimeAdapter",
              extensionLoader: {} as BootstrapResult["extensionLoader"],
            },
            hostedHttp: {
              broker: {
                fetch() {
                  throw new Error("Must not dispatch");
                },
              },
              resolve() {
                throw new Error("Must not resolve");
              },
            },
          }),
        TypeError,
        "proxy without host project execution",
      );
      assertEquals(hostReads, 0);
      assertEquals(listens, 0);
    });
  }
});
