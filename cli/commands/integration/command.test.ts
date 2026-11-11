import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseIntegrationArgs, runIntegrationOperation } from "./command.ts";
import { parseCliArgs } from "#cli/shared/args";
import { generateCommandSchema } from "../schema/command.ts";
import type { IntegrationClient } from "veryfront/integrations";

describe("integration command primitives", () => {
  it("parses JSON as format only and requires a canonical operation", () => {
    const result = parseIntegrationArgs({ _: ["integration", "connect", "github"], json: true });
    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.data.noBrowser, false);
      assertEquals(result.data.scope, "user");
    }
    assertEquals(parseIntegrationArgs({ _: ["integration", "unknown"] }).success, false);
  });
  it("passes native arguments and explicit connection independently in one call", async () => {
    const calls: unknown[] = [];
    const client = {
      runTool: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ status: "success", result: { content: [] } });
      },
    } as unknown as IntegrationClient;
    await runIntegrationOperation({
      subcommand: "call",
      target: "github__read",
      argumentsJson: '{"connection_id":"provider-field","run_id":"native-run"}',
      connectionId: "11111111-1111-4111-8111-111111111111",
      expectedConnectionGenerationId: "22222222-2222-4222-8222-222222222222",
      scope: "user",
      noBrowser: false,
      timeout: 300,
    }, client);
    assertEquals(calls, [[
      "github__read",
      { connection_id: "provider-field", run_id: "native-run" },
      {
        connectionId: "11111111-1111-4111-8111-111111111111",
        expectedConnectionGenerationId: "22222222-2222-4222-8222-222222222222",
      },
    ]]);
  });
  it("uses shared readiness without deriving permission from OAuth status", async () => {
    const calls: unknown[] = [];
    const result = {
      local_eligibility: { state: "unknown" },
      provider_verification: { state: "not_checked" },
    };
    const client = {
      checkReadiness: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(result);
      },
      status: () => {
        throw new Error("must not infer readiness from status");
      },
    } as unknown as IntegrationClient;
    const output = await runIntegrationOperation({
      subcommand: "status",
      target: "github",
      toolName: "github__get_current_user",
      scope: "user",
      noBrowser: false,
      timeout: 300,
    }, client);
    assertEquals(output, { selected_readiness: result });
    assertEquals(calls, [["github__get_current_user", {}]]);
  });
  it("fails malformed arguments before calling a provider", async () => {
    let calls = 0;
    const client = {
      runTool: () => {
        calls++;
      },
    } as unknown as IntegrationClient;
    await assertRejects(
      () =>
        runIntegrationOperation({
          subcommand: "call",
          target: "github__read",
          argumentsJson: "[]",
          scope: "user",
          noBrowser: false,
          timeout: 300,
        }, client),
      Error,
      "JSON object",
    );
    assertEquals(calls, 0);
  });
  it("fully consumes connection pages without choosing a different identity", async () => {
    const client = {
      listConnections: async function* () {
        yield { id: "first" };
        yield { id: "second" };
      },
    } as unknown as IntegrationClient;
    const result = await runIntegrationOperation({
      subcommand: "connections",
      target: "github",
      scope: "user",
      noBrowser: false,
      timeout: 300,
    }, client);
    assertEquals(result, { connections: [{ id: "first" }, { id: "second" }] });
  });
});

describe("integration public CLI contract", () => {
  it("keeps a negated browser flag separate from JSON format through the real argv parser", () => {
    const args = parseCliArgs([
      "integration",
      "connect",
      "github",
      "--no-browser",
      "--redirect-uri",
      "veryfront:callback",
      "--json",
    ]);
    const parsed = parseIntegrationArgs(args);
    assertEquals(parsed.success, true);
    if (parsed.success) {
      assertEquals(parsed.data.noBrowser, true);
      assertEquals(parsed.data.redirectUri, "veryfront:callback");
    }
    const schema = generateCommandSchema("integration");
    assertEquals(schema?.options.some((option) => option.flag === "--connection <uuid>"), true);
    assertEquals(schema?.usage.includes("connect|call"), true);
  });
});

describe("complete CLI collection output", () => {
  for (const subcommand of ["list", "tools", "connections"] as const) {
    it(`retains every ${subcommand} row from the shared client's cursor traversal`, async () => {
      async function* rows() {
        yield { name: "first" };
        yield { name: "second" };
        yield { name: "last" };
      }
      const client = {
        listIntegrations: rows,
        listTools: rows,
        listConnections: rows,
      } as unknown as IntegrationClient;
      const result = await runIntegrationOperation({
        subcommand,
        target: "github",
        scope: "user",
        noBrowser: false,
        timeout: 300,
      }, client);
      const key = subcommand === "list" ? "integrations" : subcommand;
      assertEquals(result, { [key]: [{ name: "first" }, { name: "second" }, { name: "last" }] });
    });
  }
});

describe("tools for an unconnected integration", () => {
  const catalogTools = [
    {
      id: "slack__list_channels",
      name: "List Channels",
      description: "List channels",
      requires_write: false,
      input_schema: { type: "object" },
    },
    {
      id: "slack__send_message",
      name: "Send Message",
      description: "Send a message",
      requires_write: true,
      input_schema: { type: "object" },
    },
  ];
  // deno-lint-ignore require-yield
  async function* none() {
    return;
  }
  const options = {
    subcommand: "tools" as const,
    target: "slack",
    scope: "user" as const,
    noBrowser: false,
    timeout: 300,
  };

  it("lists the catalog tools and says how to connect when the project has no connection", async () => {
    const client = {
      listTools: none,
      listConnections: none,
      getIntegration: () =>
        Promise.resolve({
          name: "slack",
          auth: {},
          credential_requirement: {},
          tools: catalogTools,
        }),
    } as unknown as IntegrationClient;

    const result = await runIntegrationOperation(options, client);

    assertEquals(result, {
      tools: [],
      connected: false,
      catalog_tools: catalogTools,
      next_step:
        "Connect slack first: run veryfront integration connect slack, then run this command again.",
    });
  });

  it("names the selected project in the connect hint", async () => {
    const client = {
      listTools: none,
      listConnections: none,
      getIntegration: () =>
        Promise.resolve({ name: "slack", auth: {}, credential_requirement: {}, tools: [] }),
    } as unknown as IntegrationClient;

    const cases: Array<[Partial<typeof options> & Record<string, string>, string]> = [
      [
        { projectReference: "acme-support" },
        "Connect slack first: run veryfront integration connect slack --project acme-support, then run this command again.",
      ],
      [
        { projectDir: "/work/My App" },
        "Connect slack first: run veryfront integration connect slack --project-dir '/work/My App', then run this command again.",
      ],
    ];
    for (const [selection, expected] of cases) {
      const result = await runIntegrationOperation({ ...options, ...selection }, client) as {
        next_step: string;
      };
      assertEquals(result.next_step, expected, "the hint connects the project this command used");
    }
  });

  it("filters the catalog tools with --search", async () => {
    const client = {
      listTools: none,
      listConnections: none,
      getIntegration: () =>
        Promise.resolve({
          name: "slack",
          auth: {},
          credential_requirement: {},
          tools: catalogTools,
        }),
    } as unknown as IntegrationClient;

    const result = await runIntegrationOperation({ ...options, search: "send" }, client) as {
      catalog_tools: unknown[];
    };

    assertEquals(result.catalog_tools, [catalogTools[1]]);
  });

  it("keeps an empty list unchanged when a connection exists", async () => {
    async function* connected() {
      yield {
        id: "11111111-1111-4111-8111-111111111111",
        integration: "slack",
        connection_generation_id: "22222222-2222-4222-8222-222222222222",
        scope: "user",
        status: "connected",
      };
    }
    let catalogReads = 0;
    const client = {
      listTools: none,
      listConnections: connected,
      getIntegration: () => {
        catalogReads++;
        return Promise.reject(new Error("unexpected catalog read"));
      },
    } as unknown as IntegrationClient;

    assertEquals(await runIntegrationOperation(options, client), { tools: [] });
    assertEquals(catalogReads, 0, "a connected integration does not read the catalog");
  });

  it("returns the tool list alone when the project has tools", async () => {
    const tool = { id: "slack__send_message", name: "Send Message" };
    async function* someTools() {
      yield tool;
    }
    let extraReads = 0;
    const client = {
      listTools: someTools,
      listConnections: () => {
        extraReads++;
        return none();
      },
      getIntegration: () => {
        extraReads++;
        return Promise.reject(new Error("unexpected catalog read"));
      },
    } as unknown as IntegrationClient;

    assertEquals(await runIntegrationOperation(options, client), { tools: [tool] });
    assertEquals(extraReads, 0, "a non-empty list makes no extra requests");
  });

  it("treats an expired connection as not connected", async () => {
    async function* expired() {
      yield {
        id: "11111111-1111-4111-8111-111111111111",
        integration: "slack",
        connection_generation_id: "22222222-2222-4222-8222-222222222222",
        scope: "user",
        status: "expired",
      };
    }
    const client = {
      listTools: none,
      listConnections: expired,
      getIntegration: () =>
        Promise.resolve({
          name: "slack",
          auth: {},
          credential_requirement: {},
          tools: catalogTools,
        }),
    } as unknown as IntegrationClient;

    const result = await runIntegrationOperation(options, client) as Record<string, unknown>;

    assertEquals(result.connected, false, "an expired connection cannot run tools");
    assertEquals(result.catalog_tools, catalogTools, "the catalog tools are listed");
  });

  it("keeps the previous output when the connection or catalog lookup fails", async () => {
    const failures: Array<[string, Partial<Record<string, unknown>>]> = [
      ["connections", {
        listConnections: () => {
          throw new Error("connections unavailable");
        },
      }],
      ["catalog", {
        getIntegration: () => Promise.reject(new Error("catalog unavailable")),
      }],
    ];
    for (const [name, override] of failures) {
      const client = {
        listTools: none,
        listConnections: none,
        getIntegration: () =>
          Promise.resolve({ name: "slack", auth: {}, credential_requirement: {}, tools: [] }),
        ...override,
      } as unknown as IntegrationClient;

      assertEquals(
        await runIntegrationOperation(options, client),
        { tools: [] },
        `a failed ${name} lookup does not turn a successful tools call into an error`,
      );
    }
  });

  it("drops malformed catalog rows and matches --search case-insensitively", async () => {
    const client = {
      listTools: none,
      listConnections: none,
      getIntegration: () =>
        Promise.resolve({
          name: "slack",
          auth: {},
          credential_requirement: {},
          tools: [null, "slack__send_message", [catalogTools[1]], ...catalogTools],
        }),
    } as unknown as IntegrationClient;

    const all = await runIntegrationOperation(options, client) as { catalog_tools: unknown[] };
    assertEquals(all.catalog_tools, catalogTools, "only object rows are listed");

    const searched = await runIntegrationOperation({ ...options, search: "SEND" }, client) as {
      catalog_tools: unknown[];
    };
    assertEquals(searched.catalog_tools, [catalogTools[1]], "search ignores letter case");
  });
});
