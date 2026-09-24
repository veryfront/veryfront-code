import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { cliErrorBoundary, VeryfrontError } from "veryfront/errors";
import { classifyCliError, safeJsonErrorContext } from "../../router.ts";
import { createErrorEnvelope, outputJson, setJsonMode } from "../../shared/json-output.ts";
import { handleIntegrationCommand } from "./handler.ts";

const project = { id: "11111111-1111-4111-8111-111111111111", slug: "fixture" };
const config = {
  apiUrl: "https://api.example.test",
  apiToken: "synthetic-private-token",
  projectSlug: project.slug,
};

describe("integration user interruption", () => {
  for (const operation of ["list", "connect", "call"] as const) {
    it(`preserves exit130 and one safe boundary envelope for interrupted ${operation}`, async () => {
      let interrupt: (() => void) | undefined, disposed = 0, operationRequests = 0;
      const error = await withMockFetch(
        async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === "/projects/fixture") return Response.json(project);
          if (path === "/integrations/tools/list") {
            return Response.json({ tools: [] }, {
              headers: { "x-veryfront-project-id": project.id },
            });
          }
          operationRequests++;
          interrupt?.();
          init?.signal?.throwIfAborted();
          throw new Error("Unexpected continuation: synthetic-private-token");
        },
        () =>
          assertRejects(() =>
            handleIntegrationCommand({
              _: [
                "integration",
                operation,
                ...(operation === "list"
                  ? []
                  : [operation === "call" ? "github__create_issue" : "github"]),
              ],
              json: true,
            }, {
              resolveConfig: () => Promise.resolve(config),
              registerSignals: (handler) => {
                interrupt = () => {
                  void handler("SIGINT");
                };
                return () => {
                  disposed++;
                };
              },
            })
          ),
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(classifyCliError(error).exitCode, 130);
      assertEquals(error.context, {
        integrationOperation: true,
        interrupted: true,
        outcomeUnknown: operation === "call",
        retryable: false,
        automaticReplay: false,
      });
      assertEquals(operationRequests, 1);
      assertEquals(disposed, 1);
      const output: string[] = [];
      const log = console.log;
      const exit = Deno.exit;
      console.log = (value) => output.push(String(value));
      setJsonMode(true);
      class Exit extends Error {
        constructor(readonly code: number) {
          super("exit");
        }
      }
      Object.defineProperty(Deno, "exit", {
        configurable: true,
        value: (code: number) => {
          throw new Exit(code);
        },
      });
      try {
        const result = await assertRejects(() =>
          cliErrorBoundary(() => Promise.reject(error), {
            onError: async (_raw, typed) => {
              const classification = classifyCliError(typed);
              await outputJson(
                createErrorEnvelope("integration", {
                  code: classification.code,
                  slug: classification.slug,
                  registrySlug: typed.slug,
                  message: typed.message,
                  context: safeJsonErrorContext(typed.context, _raw),
                }),
              );
            },
            getExitCode: (_raw, typed) => classifyCliError(typed).exitCode,
          })
        );
        assertInstanceOf(result, Exit);
        assertEquals(result.code, 130);
        assertEquals(output.length, 1);
        assertEquals(JSON.parse(output[0]!).success, false);
        assertEquals(JSON.parse(output[0]!).error.context, {
          interrupted: true,
          outcomeUnknown: operation === "call",
          retryable: false,
          automaticReplay: false,
        });
        assertEquals(output[0]!.includes(config.apiToken), false);
        assertEquals(output[0]!.includes("https://"), false);
      } finally {
        Object.defineProperty(Deno, "exit", { configurable: true, value: exit });
        console.log = log;
        setJsonMode(false);
      }
    });
  }
  it("cancels before dispatch without falsely reporting an unknown provider outcome", async () => {
    let dispatches = 0;
    const error = await withMockFetch(
      () => {
        dispatches++;
        throw new Error("unexpected request");
      },
      () =>
        assertRejects(() =>
          handleIntegrationCommand({ _: ["integration", "call", "github__create_issue"] }, {
            resolveConfig: () => Promise.resolve(config),
            registerSignals: (handler) => {
              void handler("SIGINT");
              return () => {};
            },
          })
        ),
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.exitCode, 130);
    assertEquals(error.context, {
      integrationOperation: true,
      interrupted: true,
      outcomeUnknown: false,
      retryable: false,
      automaticReplay: false,
    });
    assertEquals(dispatches, 0);
  });
});

describe("interruption versus failure", () => {
  for (const status of [500, 408]) {
    it(`keeps non-user HTTP${status} failures at exit1 with one dispatch`, async () => {
      let calls = 0;
      const error = await withMockFetch(
        async (input) => {
          const path = new URL(String(input)).pathname;
          if (path === "/projects/fixture") return Response.json(project);
          if (path === "/integrations/tools/list") {
            return Response.json({ tools: [] }, {
              headers: { "x-veryfront-project-id": project.id },
            });
          }
          calls++;
          return Response.json({
            type: "about:blank",
            title: "Failure",
            status,
            slug: status === 408 ? "request-timeout" : "internal-error",
            detail: "synthetic-private-token",
          }, { status });
        },
        () =>
          assertRejects(() =>
            handleIntegrationCommand({ _: ["integration", "call", "github__create_issue"] }, {
              resolveConfig: () => Promise.resolve(config),
              registerSignals: () => () => {},
            })
          ),
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(classifyCliError(error).exitCode, 1);
      assertEquals(calls, 1);
      assertEquals(JSON.stringify(error).includes("synthetic-private-token"), false);
    });
  }
});

describe("interactive callback interruption cleanup", () => {
  it("stops the receiver and returns130 without retrying consent or calling a tool", async () => {
    let interrupt: (() => void) | undefined, stopped = 0, disposed = 0, handoffs = 0, opens = 0;
    const token = "a".repeat(64);
    const error = await withMockFetch(
      async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/projects/fixture") return Response.json(project);
        if (path === "/integrations/tools/list") {
          return Response.json({ tools: [] }, {
            headers: { "x-veryfront-project-id": project.id },
          });
        }
        if (path === "/integrations/github") {
          return Response.json({
            name: "github",
            auth: { type: "oauth2" },
            credential_requirement: { mode: "oauth_connection" },
          });
        }
        if (path === "/oauth/status/github") {
          return Response.json({
            integration: "github",
            connected: false,
          });
        }
        if (path === "/oauth/connect/session") {
          handoffs++;
          return Response.json({
            session_token: token,
            connect_url: `${config.apiUrl}/oauth/connect/github?session_token=${token}`,
            expires_at: "2099-01-01T00:00:00.000Z",
          });
        }
        throw new Error("Unexpected request");
      },
      () =>
        assertRejects(() =>
          handleIntegrationCommand({ _: ["integration", "connect", "github"] }, {
            resolveConfig: () => Promise.resolve(config),
            registerSignals: (handler) => {
              interrupt = () => {
                void handler("SIGINT");
              };
              return () => {
                disposed++;
              };
            },
            canOpenBrowser: () => true,
            openBrowser: () => {
              opens++;
              return Promise.resolve();
            },
            startReceiver: () =>
              Promise.resolve({
                port: 9876,
                waitForCallback: (_timeout, signal) => {
                  interrupt?.();
                  signal?.throwIfAborted();
                  return Promise.reject(new Error("unexpected continuation"));
                },
                stop: () => {
                  stopped++;
                  return Promise.resolve();
                },
              }),
          })
        ),
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.exitCode, 130);
    assertEquals([stopped, disposed, handoffs, opens], [1, 1, 1, 1]);
    assertEquals(error.context, {
      integrationOperation: true,
      interrupted: true,
      outcomeUnknown: false,
      retryable: false,
      automaticReplay: false,
    });
  });
});
