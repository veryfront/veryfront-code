import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DevCommandOptions, DevCommandResult, DevOptions } from "./index.ts";
import {
  createSelectedProjectPushOptions,
  loginForDevShortcut,
  preloadDevAuth,
  startDevServerOnFreePort,
} from "./command.ts";
import { UntrustedApiUrlCredentialError } from "#cli/shared/config";

describe("cli/commands/dev", () => {
  describe("DevOptions type", () => {
    it("should accept minimal options", () => {
      const options: DevOptions = {
        port: 3000,
        projectDir: "/tmp/project",
      };

      assertEquals(options, {
        port: 3000,
        projectDir: "/tmp/project",
      });
    });

    it("should accept full options", () => {
      const options: DevOptions = {
        port: 8080,
        projectDir: "/home/user/my-app",
        hmr: true,
        demoMode: false,
      };

      assertEquals(options, {
        port: 8080,
        projectDir: "/home/user/my-app",
        hmr: true,
        demoMode: false,
      });
    });

    it("should accept demo mode", () => {
      const options: DevOptions = {
        port: 3000,
        projectDir: "/tmp/project",
        demoMode: true,
      };

      assertEquals(options.demoMode, true);
    });

    it("should accept hmr disabled", () => {
      const options: DevOptions = {
        port: 3000,
        projectDir: "/tmp/project",
        hmr: false,
      };

      assertEquals(options.hmr, false);
    });
  });

  describe("DevCommandOptions type alias", () => {
    it("should be assignable from DevOptions", () => {
      const options: DevCommandOptions = {
        port: 3000,
        projectDir: "/tmp/project",
      };

      const devOptions: DevOptions = options;
      assertEquals(devOptions.port, 3000);
    });
  });

  describe("DevCommandResult type", () => {
    it("should have ready, done, port, and stop properties", () => {
      const result: DevCommandResult = {
        ready: Promise.resolve(),
        done: Promise.resolve(),
        port: 3000,
        stop: async () => {},
      };

      assertEquals(typeof result.ready.then, "function");
      assertEquals(typeof result.done.then, "function");
      assertEquals(result.port, 3000);
      assertEquals(typeof result.stop, "function");
    });

    it("should allow awaiting ready", async () => {
      const result: DevCommandResult = {
        ready: Promise.resolve(),
        done: new Promise(() => {}), // never resolves
        port: 3000,
        stop: async () => {},
      };

      await result.ready;
    });

    it("should allow calling stop", async () => {
      let stopped = false;

      const result: DevCommandResult = {
        ready: Promise.resolve(),
        done: Promise.resolve(),
        port: 3000,
        stop: () => {
          stopped = true;
          return Promise.resolve();
        },
      };

      await result.stop();
      assertEquals(stopped, true);
    });
  });

  describe("dev command port logic", () => {
    const DEFAULT_DEV_PORT = 3000;

    function calculateFinalPort(port: number, configPort?: number): number {
      if (port !== DEFAULT_DEV_PORT) return port;
      return configPort ?? port;
    }

    it("should use user-specified port when not default", () => {
      assertEquals(calculateFinalPort(8080, 4000), 8080);
    });

    it("should use config port when user port is default", () => {
      assertEquals(calculateFinalPort(3000, 4000), 4000);
    });

    it("should fall back to default when no config port", () => {
      assertEquals(calculateFinalPort(3000, undefined), 3000);
    });

    it("should use MCP port as finalPort + 2", () => {
      const finalPort = calculateFinalPort(3000, undefined);
      assertEquals(finalPort + 2, 3002);
    });

    it("should use HMR port as finalPort + 1", () => {
      const finalPort = calculateFinalPort(8080, undefined);
      assertEquals(finalPort + 1, 8081);
    });
  });

  describe("dev server port wiring", () => {
    /** A port nothing on this machine is holding. */
    function freePort(): number {
      const probe = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const port = (probe.addr as Deno.NetAddr).port;
      probe.close();
      return port;
    }

    it("starts the server on the port it selected, not the one that was asked for", async () => {
      const held = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const heldPort = (held.addr as Deno.NetAddr).port;
      const startedOn: number[] = [];

      try {
        const started = await startDevServerOnFreePort(heldPort, (port) => {
          startedOn.push(port);
          return Promise.resolve({ id: "dev-server" });
        });

        // Which port the scan lands on depends on what else the machine runs,
        // but the server must be handed the selected one and never the held one.
        assert(started.port > heldPort, `expected a port after ${heldPort}, got ${started.port}`);
        assertEquals(startedOn, [started.port]);
        assertEquals(started.server, { id: "dev-server" });
      } finally {
        held.close();
      }
    });

    it("reports the selected port so DevCommandResult.port can carry it", async () => {
      const held = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const heldPort = (held.addr as Deno.NetAddr).port;

      try {
        const started = await startDevServerOnFreePort(
          heldPort,
          (port) => Promise.resolve({ boundTo: port }),
        );

        // devCommand returns this port as DevCommandResult.port and derives the
        // MCP port and the printed URL from it, so it must be the bound one.
        const result: DevCommandResult = {
          ready: Promise.resolve(),
          done: Promise.resolve(),
          port: started.port,
          stop: () => Promise.resolve(),
        };

        assertEquals(result.port, started.server.boundTo);
        assertEquals(result.port === heldPort, false);
      } finally {
        held.close();
      }
    });

    it("keeps the requested port when nothing is holding it", async () => {
      const port = freePort();
      const startedOn: number[] = [];

      const started = await startDevServerOnFreePort(port, (selected) => {
        startedOn.push(selected);
        return Promise.resolve(null);
      });

      assert(
        started.port >= port,
        `expected the scan to start at ${port}, got ${started.port}`,
      );
      assertEquals(startedOn, [started.port]);
    });

    it("names the port in a PORT_IN_USE error when binding loses the race", async () => {
      const port = freePort();
      let boundPort: number | undefined;

      const error = await startDevServerOnFreePort(port, (selected) => {
        boundPort = selected;
        // What the runtime throws when something grabs the port after the probe.
        return Promise.reject(
          Object.assign(new Error("listen EADDRINUSE: address already in use"), {
            code: "EADDRINUSE",
          }),
        );
      }).then(() => null, (caught: unknown) => caught);

      assert(error instanceof Error, "expected the lost bind race to reject");
      const veryfrontError = error as Error & { slug?: string };
      assertEquals(veryfrontError.slug, "port-in-use");
      assertStringIncludes(
        veryfrontError.message,
        String(boundPort),
        "the error names the port that lost the race, not the one asked for",
      );
    });

    it("lets an unrelated startup failure through untouched", async () => {
      const port = freePort();
      const boom = new Error("config blew up");

      const error = await startDevServerOnFreePort(port, () => Promise.reject(boom))
        .then(() => null, (caught: unknown) => caught);

      assertEquals(error, boom);
    });
  });

  describe("HMR enable logic", () => {
    function shouldEnableHMR(
      configHmr: boolean | undefined,
      optionHmr: boolean,
    ): boolean {
      return configHmr !== false && optionHmr;
    }

    it("should enable HMR when both config and option allow it", () => {
      assertEquals(shouldEnableHMR(undefined, true), true);
    });

    it("should disable HMR when option is false", () => {
      assertEquals(shouldEnableHMR(undefined, false), false);
    });

    it("should disable HMR when config explicitly disables it", () => {
      assertEquals(shouldEnableHMR(false, true), false);
    });

    it("should enable HMR when config is true and option is true", () => {
      assertEquals(shouldEnableHMR(true, true), true);
    });
  });

  describe("project sync shortcuts", () => {
    const selectedProject = {
      id: "project-1",
      slug: "selected-project",
      name: "Selected Project",
    };

    it("targets the project selected in the dev session when pushing", () => {
      const options = createSelectedProjectPushOptions("/tmp/project", selectedProject);

      assertEquals(options.projectDir, "/tmp/project");
      assertEquals(options.projectSlug, "selected-project");
      assertEquals(options.force, true);
      assertEquals(options.quiet, true);
    });

    it("stages the push on an isolation branch so main is not overwritten in place", () => {
      const options = createSelectedProjectPushOptions("/tmp/project", selectedProject);

      assertEquals(options.branch === "main", false);
      assertMatch(options.branch ?? "", /^push-\d{8}t\d{6}-[0-9a-f]{6}$/);
    });
  });

  describe("initial authentication", () => {
    it("preloads project sync from a resolved environment API key", async () => {
      const originalFetch = globalThis.fetch;
      const requests: Array<{ authorization: string; limit: string | null }> = [];

      try {
        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          requests.push({
            authorization: new Headers(init?.headers).get("authorization") ?? "",
            limit: url.searchParams.get("limit"),
          });
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{ id: "project-env", slug: "env-project", name: "Env Project" }],
                page_info: {},
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }) as typeof fetch;

        const result = await preloadDevAuth("vf_env_secret");

        assertEquals(result.identity, { authenticated: true, type: "apiKey" });
        assertEquals(result.projects, [
          { id: "project-env", slug: "env-project", name: "Env Project" },
        ]);
        assertEquals(requests, [
          { authorization: "Bearer vf_env_secret", limit: null },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("validates a user token once while loading projects", async () => {
      const originalFetch = globalThis.fetch;
      const paths: string[] = [];

      try {
        globalThis.fetch = ((input: string | URL | Request) => {
          const url = new URL(String(input));
          paths.push(url.pathname);

          if (url.pathname === "/me") {
            return Promise.resolve(
              Response.json({ id: "user-1", email: "dev@example.com" }),
            );
          }

          return Promise.resolve(
            Response.json({
              data: [{ id: "project-1", slug: "project-one", name: "Project One" }],
            }),
          );
        }) as typeof fetch;

        const result = await preloadDevAuth("user-token");

        assertEquals(result.identity, { id: "user-1", email: "dev@example.com" });
        assertEquals(result.projects.length, 1);
        assertEquals(paths, ["/me", "/projects"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("keeps a validated user identity when project discovery fails", async () => {
      const originalFetch = globalThis.fetch;

      try {
        globalThis.fetch = ((input: string | URL | Request) => {
          const url = new URL(String(input));
          if (url.pathname === "/me") {
            return Promise.resolve(
              Response.json({ id: "user-1", email: "dev@example.com" }),
            );
          }

          return Promise.resolve(new Response("Unavailable", { status: 503 }));
        }) as typeof fetch;

        const result = await preloadDevAuth("user-token");

        assertEquals(result, {
          identity: { id: "user-1", email: "dev@example.com" },
          projects: [],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not authenticate an API key rejected by project discovery", async () => {
      const originalFetch = globalThis.fetch;

      try {
        globalThis.fetch = (() =>
          Promise.resolve(new Response("Unauthorized", { status: 401 }))) as typeof fetch;

        const result = await preloadDevAuth("vf_invalid");

        assertEquals(result, { identity: null, projects: [] });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

describe("cli/commands/dev: --port 0", () => {
  it("hands the server a concrete port and reports that same port", async () => {
    const startedOn: number[] = [];
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));

    try {
      const started = await startDevServerOnFreePort(0, (port) => {
        startedOn.push(port);
        return Promise.resolve(null);
      });

      assert(started.port > 0, `expected a real port, got ${started.port}`);
      assertEquals(startedOn, [started.port]);
      // The user asked for "any port", so nothing was taken from them.
      assertEquals(logged.some((line) => line.includes("is in use")), false);
    } finally {
      console.log = originalLog;
    }
  });
});

describe("cli/commands/dev: auth shortcut", () => {
  it("prints a login refusal instead of rejecting", async () => {
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logged.push(args.map(String).join(" "));

    try {
      // The keyboard handler never awaits the shortcut, so a rejection here
      // escapes as an unhandled rejection and the developer never reads why
      // Veryfront refused to send a credential to the configured endpoint.
      const result = await loginForDevShortcut(() =>
        Promise.reject(
          new UntrustedApiUrlCredentialError(
            "veryfront.json selects a repository-configured API endpoint.",
          ),
        )
      );

      assertEquals(result, null);
      assert(
        logged.some((line) =>
          line.includes("veryfront.json selects a repository-configured API endpoint.")
        ),
        `expected the refusal on the dev output, got ${JSON.stringify(logged)}`,
      );
    } finally {
      console.log = originalLog;
    }
  });

  it("returns the identity when login succeeds", async () => {
    const identity = { authenticated: true, type: "apiKey" } as const;

    assertEquals(await loginForDevShortcut(() => Promise.resolve(identity)), identity);
  });
});
