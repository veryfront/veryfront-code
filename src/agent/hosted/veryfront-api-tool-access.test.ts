import { assertEquals } from "#veryfront/testing/assert.ts";
import type { ToolDefinition } from "#veryfront/tool";
import {
  filterVeryfrontApiToolDefinitionsByAccessProfile,
  filterVeryfrontApiToolDefinitionsWithAccessProfile,
  parseVeryfrontApiToolAccessProfile,
} from "./veryfront-api-tool-access.ts";

function remoteTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
  };
}

function profile(input: {
  createServerVisibility: "visible" | "hidden";
  deleteServerVisibility: "visible" | "hidden";
  resolvedAt?: string;
  validForMs?: number;
}) {
  return {
    version: 1,
    freshness: {
      resolved_at: input.resolvedAt ?? "2026-01-01T00:00:00.000Z",
      valid_for_ms: input.validForMs ?? 60_000,
      fail_closed_on_expiry: true,
    },
    families: [
      {
        family: "runtime",
        default_decision: {
          visibility: "hidden",
          reason_code: "billing_plan_restriction",
        },
        action_overrides: [
          {
            action: "create_server",
            decision: {
              visibility: input.createServerVisibility,
              reason_code: input.createServerVisibility === "visible"
                ? "allowed"
                : "billing_plan_restriction",
            },
          },
          {
            action: "delete_server",
            decision: {
              visibility: input.deleteServerVisibility,
              reason_code: input.deleteServerVisibility === "visible"
                ? "allowed"
                : "billing_plan_restriction",
            },
          },
        ],
      },
    ],
  };
}

Deno.test("parseVeryfrontApiToolAccessProfile parses the API-owned snake_case contract", () => {
  assertEquals(
    parseVeryfrontApiToolAccessProfile(profile({
      createServerVisibility: "hidden",
      deleteServerVisibility: "visible",
    })),
    {
      version: 1,
      freshness: {
        resolvedAt: "2026-01-01T00:00:00.000Z",
        validForMs: 60_000,
        failClosedOnExpiry: true,
      },
      families: [
        {
          family: "runtime",
          defaultDecision: {
            visibility: "hidden",
            reasonCode: "billing_plan_restriction",
          },
          actionOverrides: [
            {
              action: "create_server",
              decision: {
                visibility: "hidden",
                reasonCode: "billing_plan_restriction",
              },
            },
            {
              action: "delete_server",
              decision: {
                visibility: "visible",
                reasonCode: "allowed",
              },
            },
          ],
        },
      ],
    },
  );
});

Deno.test("filterVeryfrontApiToolDefinitionsByAccessProfile applies action overrides only to mapped API tools", () => {
  const parsed = parseVeryfrontApiToolAccessProfile(profile({
    createServerVisibility: "hidden",
    deleteServerVisibility: "visible",
  }));

  assertEquals(
    filterVeryfrontApiToolDefinitionsByAccessProfile({
      toolDefinitions: [
        remoteTool("create_server"),
        remoteTool("delete_server"),
        remoteTool("update_file"),
      ],
      profile: parsed,
    }).map((tool) => tool.name),
    ["delete_server", "update_file"],
  );
});

Deno.test("filterVeryfrontApiToolDefinitionsWithAccessProfile fails closed for mapped tools when the profile is stale", async () => {
  const source = {
    id: "veryfront-mcp",
    listTools: () => Promise.resolve([]),
    executeTool: () =>
      Promise.resolve(profile({
        createServerVisibility: "visible",
        deleteServerVisibility: "visible",
        resolvedAt: "2026-01-01T00:00:00.000Z",
        validForMs: 1,
      })),
  };

  assertEquals(
    (await filterVeryfrontApiToolDefinitionsWithAccessProfile({
      source,
      projectId: "project-1",
      nowMs: Date.parse("2026-01-01T00:00:01.000Z"),
      toolDefinitions: [
        remoteTool("create_server"),
        remoteTool("delete_server"),
        remoteTool("update_file"),
      ],
    })).map((tool) => tool.name),
    ["update_file"],
  );
});
