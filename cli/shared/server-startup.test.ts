import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { deleteHostSecret, setHostSecret } from "#cli/process-env";
import {
  buildDiscoveryConfig,
  buildProxyRuntimeProjectIdentity,
  prepareCliProxyModeEnvironment,
  startCliProductionServer,
} from "./server-startup.ts";
import type { RuntimeAdapter } from "veryfront/platform";
import type { StartProductionServerOptions } from "veryfront/server";
import type { HostedHttpComposition } from "veryfront/server/http-host";

describe("buildDiscoveryConfig", () => {
  it("does not scope an unlinked local project to its directory slug", () => {
    const host = createInMemoryHostRuntime({ env: { VERYFRONT_API_TOKEN: "stored-token" } });

    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
      linkedProjectSlug: undefined,
    }, host);

    assertEquals(config.projectSlug, undefined, "no slug is inferred from the directory");
    assertEquals(config.apiToken, "stored-token", "the stored token is forwarded");
  });

  it("uses a persisted project link for cloud discovery", () => {
    const host = createInMemoryHostRuntime({ env: { VERYFRONT_API_TOKEN: "stored-token" } });

    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
      linkedProjectSlug: "linked-project",
    }, host);

    assertEquals(config.projectSlug, "linked-project", "the persisted link names the project");
  });

  it("lets VERYFRONT_PROJECT_SLUG override a persisted project link", () => {
    const host = createInMemoryHostRuntime({
      env: { VERYFRONT_API_TOKEN: "stored-token", VERYFRONT_PROJECT_SLUG: "env-project" },
    });

    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
      linkedProjectSlug: "linked-project",
    }, host);

    assertEquals(config.projectSlug, "env-project", "the environment wins over the link");
  });

  it("prefers the stored login token over a blank exported one", () => {
    const host = createInMemoryHostRuntime({ env: { VERYFRONT_API_TOKEN: "   " } });
    setHostSecret("VERYFRONT_API_TOKEN", "stored-token");

    try {
      const config = buildDiscoveryConfig({
        port: 3000,
        projectDir: "/tmp/my-agent",
        signal: new AbortController().signal,
        requestInterceptor: (request: Request) => request,
        defaultProjectId: "local-my-agent",
      }, host);

      // `applyRuntimeAuthContext` normalizes a blank export to "unset" before it
      // registers the stored token, so discovery must not treat it as a token.
      assertEquals(config.apiToken, "stored-token");
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
    }
  });

  it("omits an absent token rather than forwarding an empty string", () => {
    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
    }, createInMemoryHostRuntime());

    assertEquals(config.apiToken, undefined, "no token is reported as absent");
    assertEquals(config.baseDir, "/tmp/my-agent", "the project directory is the base");
  });
});

describe("buildProxyRuntimeProjectIdentity", () => {
  it("keeps the standalone slug paired with its local project id", () => {
    assertEquals(
      buildProxyRuntimeProjectIdentity({
        defaultProjectId: "local-my-agent",
        linkedProjectSlug: "linked-project",
      }),
      {
        defaultProjectSlug: "local-my-agent",
        defaultProjectId: "local-my-agent",
      },
      "the local id doubles as the slug",
    );
  });
});

describe("prepareCliProxyModeEnvironment", () => {
  it("marks local CLI proxy mode before bootstrap and defaults NODE_ENV to development", () => {
    const host = createInMemoryHostRuntime();

    prepareCliProxyModeEnvironment(host);

    assertEquals(host.env.get("PROXY_MODE"), "1", "proxy mode is on");
    assertEquals(host.env.get("VERYFRONT_CLI_LOCAL_PROXY_MODE"), "1", "local proxy mode is on");
    assertEquals(host.env.get("NODE_ENV"), "development", "NODE_ENV defaults to development");
  });

  it("preserves an existing runtime environment while marking local CLI proxy mode", () => {
    const host = createInMemoryHostRuntime({ env: { DENO_ENV: "test" } });

    prepareCliProxyModeEnvironment(host);

    assertEquals(host.env.get("PROXY_MODE"), "1", "proxy mode is on");
    assertEquals(host.env.get("VERYFRONT_CLI_LOCAL_PROXY_MODE"), "1", "local proxy mode is on");
    assertEquals(host.env.get("NODE_ENV"), undefined, "NODE_ENV stays unset beside DENO_ENV");
    assertEquals(host.env.get("DENO_ENV"), "test", "DENO_ENV is untouched");
  });

  it("never touches the process it was not given", () => {
    const host = createInMemoryHostRuntime();
    const bystander = createInMemoryHostRuntime();

    prepareCliProxyModeEnvironment(host);

    assertEquals(bystander.env.toObject(), {}, "another host sees no writes");
  });
});

describe("startCliProductionServer hosted HTTP composition", () => {
  const adapter = {
    fs: { readFile: () => Promise.reject(new Error("no local manifest")) },
  } as unknown as RuntimeAdapter;
  const baseOptions = {
    projectDir: "/project",
    port: 0,
    bindAddress: "127.0.0.1",
    signal: new AbortController().signal,
    defaultProjectSlug: "local",
    defaultProjectId: "local",
    adapter,
  };
  const config = { maxActive: 1 } as never;

  function fakeComposition(events: string[]): HostedHttpComposition {
    return {
      ingress: {
        broker: { fetch: () => Promise.resolve(new Response()) },
        resolve: () => Promise.reject(new Error("not used")),
      },
      shutdown: () => {
        events.push("broker.shutdown");
        return Promise.resolve();
      },
    };
  }

  /** Flag on, proxy mode on, and a host module that returns `composition`. */
  function hostedOn(composition: HostedHttpComposition) {
    return {
      isHostedHttpEnabled: () => true,
      readProxyMode: () => "1",
      ensureContentProcessor: () => Promise.resolve(),
      loadHostedHttp: () =>
        Promise.resolve({
          readHostedHttpCompositionConfig: () => config,
          createHostedHttpComposition: (value: unknown) => {
            assertEquals(value, config);
            return Promise.resolve(composition);
          },
        }),
    };
  }

  function server(stop: () => Promise<void> = () => Promise.resolve()) {
    return Promise.resolve({ ready: Promise.resolve(), stop });
  }

  it("leaves hosted HTTP off and never loads its module when the host flag is off", async () => {
    let received: StartProductionServerOptions | undefined;
    let loads = 0;
    const handle = await startCliProductionServer(baseOptions, {
      isHostedHttpEnabled: () => false,
      ensureContentProcessor: () => Promise.resolve(),
      loadHostedHttp: () => {
        loads++;
        return Promise.reject(new Error("must not load"));
      },
      startServer: (options) => {
        received = options;
        return server();
      },
    });
    await handle.stop();
    assertEquals(received?.hostedHttp, undefined);
    assertEquals(loads, 0);
  });

  it("passes the host composition to the server and shuts the broker down after stop", async () => {
    const events: string[] = [];
    const composition = fakeComposition(events);
    let received: StartProductionServerOptions | undefined;
    const handle = await startCliProductionServer(baseOptions, {
      ...hostedOn(composition),
      startServer: (options) => {
        received = options;
        return server(() => {
          events.push("server.stop");
          return Promise.resolve();
        });
      },
    });
    assertEquals(received?.hostedHttp === composition.ingress, true);
    await handle.stop();
    assertEquals(events, ["server.stop", "broker.shutdown"]);
  });

  it("refuses the flag without proxy mode before loading the host module", async () => {
    let loads = 0;
    let started = 0;
    await assertRejects(
      () =>
        startCliProductionServer(baseOptions, {
          isHostedHttpEnabled: () => true,
          readProxyMode: () => undefined,
          loadHostedHttp: () => {
            loads++;
            return Promise.reject(new Error("must not load"));
          },
          startServer: () => {
            started++;
            return server();
          },
        }),
      TypeError,
      "PROXY_MODE=1",
    );
    assertEquals([loads, started], [0, 0]);
  });

  it("shuts the broker down when the server stop fails", async () => {
    const events: string[] = [];
    const handle = await startCliProductionServer(baseOptions, {
      ...hostedOn(fakeComposition(events)),
      startServer: () => server(() => Promise.reject(new Error("stop failed"))),
    });
    await assertRejects(() => handle.stop(), Error, "stop failed");
    assertEquals(events, ["broker.shutdown"]);
  });

  it("shuts the broker down when the server refuses to start", async () => {
    const events: string[] = [];
    await assertRejects(
      () =>
        startCliProductionServer(baseOptions, {
          ...hostedOn(fakeComposition(events)),
          startServer: () => Promise.reject(new TypeError("Hosted HTTP ingress requires a proxy")),
        }),
      TypeError,
      "requires a proxy",
    );
    assertEquals(events, ["broker.shutdown"]);
  });

  it("stops the listener and the broker when startup fails after listening", async () => {
    const events: string[] = [];
    await assertRejects(
      () =>
        startCliProductionServer(baseOptions, {
          ...hostedOn(fakeComposition(events)),
          ensureContentProcessor: () => Promise.reject(new Error("content processor failed")),
          startServer: () =>
            server(() => {
              events.push("server.stop");
              return Promise.resolve();
            }),
        }),
      Error,
      "content processor failed",
    );
    assertEquals(events, ["server.stop", "broker.shutdown"]);
  });

  it("fails startup on an invalid host configuration before starting the server", async () => {
    let started = 0;
    await assertRejects(
      () =>
        startCliProductionServer(baseOptions, {
          isHostedHttpEnabled: () => true,
          readProxyMode: () => "1",
          loadHostedHttp: () =>
            Promise.resolve({
              readHostedHttpCompositionConfig: () => {
                throw new TypeError("VERYFRONT_EXECUTOR_ALLOCATOR_URL is required");
              },
              createHostedHttpComposition: () => Promise.reject(new Error("must not compose")),
            }),
          startServer: () => {
            started++;
            return server();
          },
        }),
      TypeError,
      "ALLOCATOR_URL",
    );
    assertEquals(started, 0);
  });
});
