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
      call: (...args: unknown[]) => {
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
  it("fails malformed arguments before calling a provider", async () => {
    let calls = 0;
    const client = {
      call: () => {
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
        discover: rows,
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
