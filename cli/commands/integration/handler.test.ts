import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { IntegrationClient } from "veryfront/integrations";
import { setJsonMode } from "../../shared/json-output.ts";
import { handleIntegrationCommand } from "./handler.ts";

describe("integration CLI envelopes", () => {
  it("preserves native tool failure in one envelope and exits nonzero without replay", async () => {
    const output: string[] = [];
    const prior = console.log;
    let calls = 0, disposed = 0, exit = 0;
    console.log = (value) => output.push(String(value));
    setJsonMode(true);
    const result = {
      status: "tool_error",
      result: {
        content: [{ type: "image", data: "synthetic" }],
        structuredContent: { error: "authentication_required" },
      },
    };
    try {
      await handleIntegrationCommand({
        _: ["integration", "call", "github__get_current_user"],
        project: "explicit",
        json: true,
      }, {
        resolveConfig: (_dir, env) => {
          assertEquals(env?.projectSlug, "explicit");
          return Promise.resolve({
            apiUrl: "https://api.example.test",
            apiToken: "synthetic-token",
            projectSlug: "explicit",
          });
        },
        createClient: (context) => {
          assertEquals(context.projectReference, "explicit");
          return Promise.resolve({
            call: () => {
              calls++;
              return Promise.resolve(result);
            },
          } as unknown as IntegrationClient);
        },
        registerSignals: () => () => {
          disposed++;
        },
        exit: (code) => {
          exit = code;
        },
      });
      assertEquals(output.length, 1);
      const envelope = JSON.parse(output[0]!);
      assertEquals(envelope.success, false);
      assertEquals(envelope.data, result);
      assertEquals(envelope.error.context, undefined);
      assertEquals([calls, disposed, exit], [1, 1, 1]);
    } finally {
      console.log = prior;
      setJsonMode(false);
    }
  });
  it("rejects selectors on operations that cannot honor them before dispatch", async () => {
    let resolutions = 0;
    await assertRejects(
      () =>
        handleIntegrationCommand({
          _: ["integration", "connect", "github"],
          connection: "11111111-1111-4111-8111-111111111111",
        }, {
          resolveConfig: () => {
            resolutions++;
            throw new Error("unexpected resolution");
          },
        }),
      Error,
      "--connection",
    );
    assertEquals(resolutions, 0);
  });
  it("rejects invalid generation selectors before resolving credentials", async () => {
    let resolutions = 0;
    for (
      const args of [
        {
          _: ["integration", "call", "github__get_current_user"],
          "expected-generation": "22222222-2222-4222-8222-222222222222",
        },
        {
          _: ["integration", "status", "github"],
          connection: "11111111-1111-4111-8111-111111111111",
          "expected-generation": "22222222-2222-4222-8222-222222222222",
        },
      ]
    ) {
      await assertRejects(
        () =>
          handleIntegrationCommand(args, {
            resolveConfig: () => {
              resolutions++;
              throw new Error("unexpected resolution");
            },
          }),
        Error,
        "--expected-generation",
      );
    }
    assertEquals(resolutions, 0);
  });
  it("rejects mismatched readiness tool and scope selectors before credentials", async () => {
    let resolutions = 0;
    for (
      const args of [
        { _: ["integration", "status", "github"], tool: "jira__get_issue" },
        {
          _: ["integration", "status", "github"],
          tool: "github__get_current_user",
          scope: "project",
        },
        { _: ["integration", "list"], tool: "github__get_current_user" },
      ]
    ) {
      await assertRejects(() =>
        handleIntegrationCommand(args, {
          resolveConfig: () => {
            resolutions++;
            throw new Error("unexpected");
          },
        }), Error);
    }
    assertEquals(resolutions, 0);
  });
  it("does not construct a client after trusted configuration fails", async () => {
    let clients = 0, disposed = 0;
    await assertRejects(
      () =>
        handleIntegrationCommand({ _: ["integration", "list"] }, {
          resolveConfig: () =>
            Promise.reject(new Error("Missing API token. Run 'veryfront login'")),
          createClient: () => {
            clients++;
            throw new Error("unexpected");
          },
          registerSignals: () => () => {
            disposed++;
          },
        }),
      Error,
      "veryfront login",
    );
    assertEquals([clients, disposed], [0, 1]);
  });
});
