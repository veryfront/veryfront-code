import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { IntegrationClient, IntegrationConnectOptions } from "veryfront/integrations";
import { connectIntegration } from "./connect.ts";
const options = {
  subcommand: "connect" as const,
  target: "github",
  scope: "user" as const,
  noBrowser: false,
  timeout: 300,
};
describe("bounded integration handoff", () => {
  it("returns non-OAuth setup without opening a browser or allocating a receiver", async () => {
    const client = {
      connect: () =>
        Promise.resolve({ status: "setup_required", integration: "github", details: {} }),
    } as unknown as IntegrationClient;
    const result = await connectIntegration(client, options, { canOpenBrowser: () => false });
    assertEquals(result, { status: "setup_required", integration: "github", details: {} });
  });
  it("requires an explicit headless redirect only when OAuth needs it", async () => {
    const client = {
      connect: async (_: string, input: IntegrationConnectOptions) => {
        if (typeof input.redirectUri === "function") await input.redirectUri();
      },
    } as unknown as IntegrationClient;
    await assertRejects(
      () => connectIntegration(client, { ...options, noBrowser: true }),
      Error,
      "--redirect-uri",
    );
  });
  it("exposes the handoff URL only in explicit headless output and never waits for a callback", async () => {
    const client = {
      connect: async (_: string, input: IntegrationConnectOptions) => {
        assertEquals(await (input.redirectUri as () => Promise<string>)(), "veryfront:callback");
        return {
          status: "oauth_handoff",
          integration: "github",
          project_id: "project",
          scope: "user",
          connect_url: "https://synthetic.example/handoff",
          expires_at: "2099-01-01T00:00:00.000Z",
        };
      },
    } as unknown as IntegrationClient;
    assertEquals(
      await connectIntegration(client, {
        ...options,
        noBrowser: true,
        redirectUri: "veryfront:callback",
      }),
      {
        status: "oauth_handoff",
        integration: "github",
        project_id: "project",
        scope: "user",
        connect_url: "https://synthetic.example/handoff",
        expires_at: "2099-01-01T00:00:00.000Z",
      },
    );
  });
});

describe("interactive observed connection", () => {
  for (const changed of [true, false]) {
    it(
      changed
        ? "accepts a fresh matching generation and cleans up"
        : "rejects an unchanged preexisting connection without claiming success",
      async () => {
        let reads = 0, stopped = 0, opens = 0;
        const client = {
          project: { id: "project", slug: "project" },
          status: () =>
            Promise.resolve({
              connected: true,
              integration: "github",
              connection_id: "account",
              connection_generation_id: reads++ === 0 || !changed ? "old" : "new",
            }),
          listConnections: async function* () {
            yield {
              id: "account",
              integration: "github",
              scope: "user",
              status: "connected",
              connection_generation_id: changed ? "new" : "old",
            };
          },
          connect: async (_: string, input: IntegrationConnectOptions) => {
            const uri = new URL(await (input.redirectUri as () => Promise<string>)());
            assertEquals(uri.searchParams.get("project_id"), "project");
            assertEquals(uri.searchParams.get("scope"), "user");
            assertEquals(Boolean(uri.searchParams.get("state")), true);
            return {
              status: "oauth_handoff",
              connect_url: "https://synthetic.example/handoff",
              expires_at: "2099-01-01T00:00:00.000Z",
            };
          },
        } as unknown as IntegrationClient;
        const run = () =>
          connectIntegration(client, options, {
            canOpenBrowser: () => true,
            openBrowser: () => {
              opens++;
              return Promise.resolve();
            },
            startReceiver: () =>
              Promise.resolve({
                port: 9876,
                waitForCallback: () => Promise.resolve({ status: "received" }),
                stop: () => {
                  stopped++;
                  return Promise.resolve();
                },
              }),
          });
        if (changed) {
          assertEquals((await run() as { status: string }).status, "connection_observed");
        } else await assertRejects(run, Error, "fresh matching connection metadata");
        assertEquals([opens, reads, stopped], [1, changed ? 2 : 5, 1]);
      },
    );
  }
  it("stops the receiver after denied consent without status polling or tool execution", async () => {
    let reads = 0, stopped = 0;
    const client = {
      project: { id: "project" },
      status: () => {
        reads++;
        return Promise.resolve({ connected: false });
      },
      connect: async (_: string, input: IntegrationConnectOptions) => {
        await (input.redirectUri as () => Promise<string>)();
        return {
          status: "oauth_handoff",
          connect_url: "https://synthetic.example/handoff",
          expires_at: "2099-01-01T00:00:00.000Z",
        };
      },
    } as unknown as IntegrationClient;
    await assertRejects(
      () =>
        connectIntegration(client, options, {
          canOpenBrowser: () => true,
          openBrowser: () => Promise.resolve(),
          startReceiver: () =>
            Promise.resolve({
              port: 9876,
              waitForCallback: () => Promise.resolve({ status: "denied" }),
              stop: () => {
                stopped++;
                return Promise.resolve();
              },
            }),
        }),
      Error,
      "consent was denied",
    );
    assertEquals([reads, stopped], [1, 1]);
  });
});

describe("connection metadata propagation", () => {
  for (const outcome of ["delayed", "aborted", "deadline"] as const) {
    it(`bounds ${outcome} observation without another handoff or tool call`, async () => {
      const controller = new AbortController();
      let reads = 0, connects = 0, stopped = 0, clock = 0;
      const client = {
        project: { id: "project", slug: "project" },
        status: (_: string, _scope: string, readOptions?: { abortSignal?: AbortSignal }) => {
          reads++;
          if (reads > 1 && outcome === "aborted") {
            controller.abort(new DOMException("cancelled", "AbortError"));
            readOptions?.abortSignal?.throwIfAborted();
          }
          return Promise.resolve({
            connected: true,
            integration: "github",
            connection_id: "account",
            connection_generation_id: reads >= 3 ? "new" : "old",
          });
        },
        listConnections: async function* () {
          yield {
            id: "account",
            integration: "github",
            scope: "user",
            status: "connected",
            connection_generation_id: reads >= 3 ? "new" : "old",
          };
        },
        connect: async (_: string, input: IntegrationConnectOptions) => {
          connects++;
          await (input.redirectUri as () => Promise<string>)();
          return {
            status: "oauth_handoff",
            connect_url: "https://synthetic.example/handoff",
            expires_at: "2099-01-01T00:00:00.000Z",
          };
        },
      } as unknown as IntegrationClient;
      const run = () =>
        connectIntegration(client, options, {
          canOpenBrowser: () => true,
          openBrowser: () => Promise.resolve(),
          now: () => clock,
          startReceiver: () =>
            Promise.resolve({
              port: 9876,
              waitForCallback: () => {
                if (outcome === "deadline") clock = 300001;
                return Promise.resolve({ status: "received" });
              },
              stop: () => {
                stopped++;
                return Promise.resolve();
              },
            }),
        }, controller.signal);
      if (outcome === "delayed") {
        assertEquals((await run() as { status: string }).status, "connection_observed");
      } else {await assertRejects(
          run,
          Error,
          outcome === "aborted" ? "cancelled" : "fresh matching",
        );}
      assertEquals(connects, 1);
      assertEquals(stopped, 1);
      assertEquals(reads, outcome === "delayed" ? 3 : outcome === "aborted" ? 2 : 1);
    });
  }
});

describe("local consent launch deadline", () => {
  it("does not open a still-valid handoff after the local callback budget has elapsed", async () => {
    let clock = 0, opens = 0, stopped = 0;
    const client = {
      project: { id: "project" },
      status: () => Promise.resolve({ connected: false }),
      connect: async (_: string, input: IntegrationConnectOptions) => {
        await (input.redirectUri as () => Promise<string>)();
        clock = 2000;
        return {
          status: "oauth_handoff",
          connect_url: "https://synthetic.example/handoff",
          expires_at: "2099-01-01T00:00:00.000Z",
        };
      },
    } as unknown as IntegrationClient;
    await assertRejects(
      () =>
        connectIntegration(client, { ...options, timeout: 1 }, {
          now: () => clock,
          canOpenBrowser: () => true,
          openBrowser: () => {
            opens++;
            return Promise.resolve();
          },
          startReceiver: () =>
            Promise.resolve({
              port: 9876,
              waitForCallback: () => Promise.resolve({ status: "received" }),
              stop: () => {
                stopped++;
                return Promise.resolve();
              },
            }),
        }),
      Error,
      "local callback wait deadline",
    );
    assertEquals([opens, stopped], [0, 1]);
  });
});

describe("cancellable browser launch", () => {
  for (const cancellation of ["deadline", "user"] as const) {
    it(`terminates a hanging launcher on ${cancellation} and closes the receiver`, async () => {
      const controller = new AbortController();
      let stopped = 0, launcherStopped = false;
      const client = {
        project: { id: "project" },
        status: () => Promise.resolve({ connected: false }),
        connect: async (_: string, input: IntegrationConnectOptions) => {
          await (input.redirectUri as () => Promise<string>)();
          return {
            status: "oauth_handoff",
            connect_url: "https://synthetic.example/handoff",
            expires_at: "2099-01-01T00:00:00.000Z",
          };
        },
      } as unknown as IntegrationClient;
      await assertRejects(
        () =>
          connectIntegration(client, { ...options, timeout: 1 }, {
            canOpenBrowser: () => true,
            openBrowser: (_url, launchOptions) =>
              new Promise((resolve, reject) => {
                const watchdog = setTimeout(resolve, 1500);
                launchOptions?.signal?.addEventListener("abort", () => {
                  launcherStopped = true;
                  clearTimeout(watchdog);
                  reject(launchOptions.signal?.reason);
                }, { once: true });
                if (cancellation === "user") {
                  controller.abort(new DOMException("cancelled", "AbortError"));
                }
              }),
            startReceiver: () =>
              Promise.resolve({
                port: 9876,
                waitForCallback: () => Promise.reject(new Error("callback should not be reached")),
                stop: () => {
                  stopped++;
                  return Promise.resolve();
                },
              }),
          }, controller.signal),
        Error,
        cancellation === "user" ? "cancelled" : "local callback wait deadline",
      );
      assertEquals(launcherStopped, true);
      assertEquals(stopped, 1);
    });
  }
});
