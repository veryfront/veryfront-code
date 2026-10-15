import { validateToken } from "../../../../../../cli/auth/login.ts";
import "#veryfront/schemas/_test-setup.ts";
import { createApiClient } from "../../../../../../cli/shared/config.ts";
import { withOnboardingDeadline } from "../../../../../../cli/shared/onboarding-fetch.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  connectedDevApiBaseUrl,
  connectedDevStudioBaseUrl,
  createConnectedDevControlPlane,
  prepareConnectedDev,
} from "../../../../../../cli/commands/dev/connected-dev.ts";

describe("connected local development", () => {
  it("leaves unlinked projects standalone without authentication", async () => {
    assertEquals(
      await prepareConnectedDev(undefined, "preview", {
        authenticate: () => {
          throw new Error("must not authenticate");
        },
        resolve: () => {
          throw new Error("must not resolve");
        },
      }),
      undefined,
    );
  });

  it("requires login before a linked server starts", async () => {
    await assertRejects(
      () =>
        prepareConnectedDev("demo", "preview", {
          authenticate: () => Promise.resolve(false),
          resolve: () => {
            throw new Error("must not resolve");
          },
        }),
      Error,
      "veryfront login",
    );
  });

  it("passes explicit environment selection to the project resolver", async () => {
    const calls: string[][] = [];
    const result = await prepareConnectedDev("demo", "staging", {
      authenticate: () => Promise.resolve(true),
      resolve: (project, environment) => {
        calls.push([project, environment]);
        return Promise.resolve({
          projectId: "p",
          projectSlug: "demo",
          environmentId: "e",
          environmentName: "staging",
        });
      },
    });
    assertEquals(calls, [["demo", "staging"]]);
    assertEquals(result?.environmentId, "e");
  });
});

it("uses the official API for an implicitly qualified default credential", () => {
  assertEquals(connectedDevApiBaseUrl(), "https://api.veryfront.com");
  assertEquals(connectedDevApiBaseUrl("http://localhost:4400"), "http://localhost:4400");
});

it("excludes proxy projects from local Cloud admission", async () => {
  assertEquals(
    await prepareConnectedDev("proxy-project", "preview", {
      authenticate: () => {
        throw new Error("must not authenticate local Cloud runtime");
      },
      resolve: () => {
        throw new Error("must not resolve or mutate association");
      },
    }, true),
    undefined,
  );
});

it("stops MCP and dev servers even when connected runtime disposal rejects", async () => {
  const { stopDevServices } = await import("../../../../../../cli/commands/dev/connected-dev.ts");
  const stopped: string[] = [];
  const failure = new Error("runtime disposal rejected");
  let caught: unknown;
  try {
    await stopDevServices([
      () => Promise.reject(failure),
      () => {
        stopped.push("mcp");
      },
      () => {
        stopped.push("dev");
      },
    ]);
  } catch (error) {
    caught = error;
  }
  assertEquals(stopped, ["mcp", "dev"]);
  assertEquals(caught instanceof AggregateError, true);
  assertEquals((caught as AggregateError).errors, [failure]);
});

it("connected preflight ignores a project-replaced global fetch", async () => {
  let hostRequests = 0;
  let projectRequests = 0;
  await withMockFetch(() => {
    hostRequests++;
    throw new Error("host transport reached");
  }, async () => {
    // Fault injection models project config replacing the global, not a network stub.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      projectRequests++;
      throw new Error("project transport reached");
    };
    try {
      const controlPlane = createConnectedDevControlPlane({
        apiUrl: "https://api.example.com",
        apiToken: "fake-private-token",
        projectSlug: "demo",
      });
      await assertRejects(() => controlPlane.getProject("demo"), Error, "host transport reached");
      assertEquals(hostRequests, 1);
      assertEquals(projectRequests, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

it("resolves the Studio origin for the connected API without an override", () => {
  assertEquals(connectedDevStudioBaseUrl("http://localhost:4400"), "http://localhost:3000");
  assertEquals(connectedDevStudioBaseUrl("http://127.0.0.1:4000"), "http://localhost:3000");
  assertEquals(connectedDevStudioBaseUrl("http://[::1]:4000"), "http://localhost:3000");
  assertEquals(connectedDevStudioBaseUrl("https://api.veryfront.com"), "https://veryfront.com");
  assertEquals(connectedDevStudioBaseUrl("https://api.veryfront.org/api"), "https://veryfront.org");
});

it("keeps an explicit Studio override for any connected API", () => {
  assertEquals(
    connectedDevStudioBaseUrl("https://api.example.com", "http://localhost:3440"),
    "http://localhost:3440",
  );
  assertEquals(
    connectedDevStudioBaseUrl("http://localhost:4400", "http://localhost:3440"),
    "http://localhost:3440",
  );
});

it("requires a Studio override for an unsupported connected API", () => {
  assertThrows(
    () => connectedDevStudioBaseUrl("https://api.example.com"),
    Error,
    "Set STUDIO_URL",
  );
});

for (const path of ["project", "environment"]) {
  it(`bounds connected ${path} preflight without reporting a missing target`, async () => {
    await withMockFetch((_input, init) => {
      if (!init?.signal) throw new Error("unbounded onboarding request");
      return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
    }, async () => {
      const controlPlane = createConnectedDevControlPlane({
        apiUrl: "https://api.example.com",
        apiToken: "private",
        projectSlug: "demo",
      }, { timeoutMs: 5 });
      await assertRejects(
        () =>
          path === "project"
            ? controlPlane.getProject("demo")
            : controlPlane.getEnvironment("demo", "preview"),
        Error,
        "timed out",
      );
    });
  });
}

for (const onboarding of [false, true]) {
  for (
    const kind of [
      "json",
      "error",
      "empty",
      "binary",
      ...(onboarding ? ["auth", "auth-rejection"] : []),
    ]
  ) {
    it(`consumes trusted ${kind} API responses after project prototype replacement (onboarding=${onboarding})`, async () => {
      const response = kind === "error" || kind === "auth-rejection"
        ? Response.json({ detail: "trusted rejection" }, { status: 403 })
        : kind === "empty"
        ? new Response(null, { status: 204 })
        : kind === "binary"
        ? new Response("trusted bytes", { headers: { "content-type": "application/octet-stream" } })
        : Response.json({ secret: "trusted value" });
      const responseFields = [
        "body",
        "headers",
        "ok",
        "status",
        "statusText",
        "json",
        "arrayBuffer",
        "text",
        "clone",
      ];
      const responseDescriptors = responseFields.map((name) =>
        [name, Object.getOwnPropertyDescriptor(Response.prototype, name)!] as const
      );
      const headerFields = ["get", Symbol.iterator] as const;
      const headerDescriptors = headerFields.map((name) =>
        [name, Object.getOwnPropertyDescriptor(Headers.prototype, name)!] as const
      );
      const cancelDescriptor = Object.getOwnPropertyDescriptor(ReadableStream.prototype, "cancel")!;
      let poisonedCalls = 0;
      const poison = () => {
        poisonedCalls++;
        throw new Error("project response hook invoked");
      };
      let result: unknown;
      let failure: unknown;
      try {
        Object.defineProperty(ReadableStream.prototype, "cancel", {
          ...cancelDescriptor,
          value: poison,
        });
        for (const [name, descriptor] of responseDescriptors) {
          Object.defineProperty(
            Response.prototype,
            name,
            "get" in descriptor ? { ...descriptor, get: poison } : { ...descriptor, value: poison },
          );
        }
        for (const [name, descriptor] of headerDescriptors) {
          Object.defineProperty(Headers.prototype, name, { ...descriptor, value: poison });
        }
        const transport: typeof fetch = () => Promise.resolve(response);
        const client = createApiClient({
          apiUrl: "https://api.example.test",
          apiToken: "private",
          projectSlug: "demo",
        }, onboarding ? withOnboardingDeadline(transport) : transport);
        try {
          if (kind === "auth-rejection") {
            result = await validateToken("private", undefined, {
              apiBaseUrl: "https://api.example.test",
              transport: withOnboardingDeadline(transport),
              throwOnCredentialValidationUnavailable: true,
            });
          } else if (kind === "auth") {
            const trusted = await withOnboardingDeadline(transport)("https://api.example.test/me");
            result = {
              ok: trusted.ok,
              status: trusted.status,
              contentType: trusted.headers.get("content-type"),
              body: await trusted.json(),
            };
          } else {
            result = kind === "binary"
              ? await client.getStream!("/projects/demo/upload")
              : await client.get("/projects/demo");
          }
        } catch (error) {
          failure = error;
        }
      } finally {
        Object.defineProperty(ReadableStream.prototype, "cancel", cancelDescriptor);
        for (const [name, descriptor] of responseDescriptors) {
          Object.defineProperty(Response.prototype, name, descriptor);
        }
        for (const [name, descriptor] of headerDescriptors) {
          Object.defineProperty(Headers.prototype, name, descriptor);
        }
      }
      assertEquals(poisonedCalls, 0);
      if (kind === "error") assertEquals((failure as Error)?.message, "trusted rejection");
      else {
        if (failure) throw failure;
        if (kind === "auth-rejection") assertEquals(result, null);
        else if (kind === "binary") {
          assertEquals(
            await new Response(result as ReadableStream<Uint8Array>).text(),
            "trusted bytes",
          );
        } else if (kind === "auth") {
          assertEquals(result, {
            ok: true,
            status: 200,
            contentType: "application/json",
            body: { secret: "trusted value" },
          });
        } else assertEquals(result, kind === "empty" ? undefined : { secret: "trusted value" });
      }
    });
  }
}
