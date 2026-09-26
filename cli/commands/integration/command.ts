import { parseIntegrationToolIdentity } from "#veryfront/integrations/source-policy.ts";
import { MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH } from "#veryfront/integrations/limits.ts";
import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import { INVALID_ARGUMENT } from "veryfront/errors";
import type { IntegrationClient } from "veryfront/integrations";

const schema = defineSchema((v) =>
  v.object({
    subcommand: v.enum(["list", "get", "connections", "tools", "status", "connect", "call"]),
    target: v.string().min(1).optional(),
    projectReference: v.string().min(1).optional(),
    projectDir: v.string().optional(),
    scope: v.enum(["user", "project"]).default("user"),
    connectionId: v.string().uuid().optional(),
    expectedConnectionGenerationId: v.string().uuid().optional(),
    argumentsJson: v.string().optional(),
    search: v.string().optional(),
    toolName: v.string().min(1).optional(),
    noBrowser: v.boolean().default(false),
    redirectUri: v.string().optional(),
    timeout: v.number().int().min(1).max(3600).default(300),
  })
);
export type IntegrationCommandOptions = InferSchema<ReturnType<typeof schema>>;
export const parseIntegrationArgs = createArgParser(lazySchema(schema), {
  subcommand: { keys: [], type: "string", positional: 0 },
  target: { keys: [], type: "string", positional: 1 },
  projectReference: CommonArgs.projectSlug,
  projectDir: CommonArgs.projectDir,
  scope: { keys: ["scope"], type: "string" },
  connectionId: { keys: ["connection"], type: "string" },
  expectedConnectionGenerationId: { keys: ["expected-generation"], type: "string" },
  argumentsJson: { keys: ["args"], type: "string" },
  search: { keys: ["search"], type: "string" },
  toolName: { keys: ["tool"], type: "string" },
  noBrowser: { keys: ["no-browser"], type: "boolean" },
  redirectUri: { keys: ["redirect-uri"], type: "string" },
  timeout: { keys: ["timeout"], type: "number" },
}, { rejectUnknown: true });
export async function collectIntegrationRows<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const row of rows) result.push(row);
  return result;
}
export function requireIntegrationTarget(options: IntegrationCommandOptions): string {
  if (!options.target) {
    throw INVALID_ARGUMENT.create({ detail: "An integration or canonical tool name is required." });
  }
  const valid = options.subcommand === "call"
    ? options.target.length <= MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH &&
      parseIntegrationToolIdentity(options.target) !== null
    : /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(options.target);
  if (!valid) {
    throw INVALID_ARGUMENT.create({
      detail: options.subcommand === "call"
        ? "Tool name must use canonical integration__tool_id format."
        : "Integration name must be a canonical identifier.",
    });
  }
  return options.target;
}
export async function runIntegrationOperation(
  options: IntegrationCommandOptions,
  client: IntegrationClient,
): Promise<unknown> {
  if (options.subcommand === "list") {
    return {
      integrations: await collectIntegrationRows(client.discover({ search: options.search })),
    };
  }
  const target = requireIntegrationTarget(options);
  switch (options.subcommand) {
    case "get":
      return client.getIntegration(target);
    case "connections":
      return { connections: await collectIntegrationRows(client.listConnections(target)) };
    case "tools":
      return {
        tools: await collectIntegrationRows(client.listTools(target, { name: options.search })),
      };
    case "status": {
      if (options.toolName) {
        return {
          selected_readiness: await client.readiness(options.toolName, {
            ...(options.connectionId ? { connectionId: options.connectionId } : {}),
            ...(options.expectedConnectionGenerationId
              ? { expectedConnectionGenerationId: options.expectedConnectionGenerationId }
              : {}),
          }),
        };
      }
      const status = await client.status(target, options.scope);
      const connections = await collectIntegrationRows(client.listConnections(target));
      const selected = options.connectionId
        ? connections.find((row) => row.id === options.connectionId && row.scope === options.scope)
        : undefined;
      if (options.connectionId && !selected) {
        throw INVALID_ARGUMENT.create({
          detail: "The selected connection is not visible in the requested scope.",
        });
      }
      return { status, connections, ...(selected ? { selected_connection: selected } : {}) };
    }
    case "call": {
      let args: unknown;
      try {
        args = JSON.parse(options.argumentsJson ?? "{}");
      } catch {
        throw INVALID_ARGUMENT.create({ detail: "--args must contain a valid JSON object." });
      }
      if (args === null || typeof args !== "object" || Array.isArray(args)) {
        throw INVALID_ARGUMENT.create({ detail: "--args must contain a JSON object." });
      }
      return client.call(target, args as Record<string, unknown>, {
        connectionId: options.connectionId,
        ...(options.expectedConnectionGenerationId !== undefined
          ? { expectedConnectionGenerationId: options.expectedConnectionGenerationId }
          : {}),
      });
    }
    default:
      throw INVALID_ARGUMENT.create({ detail: "Connect requires the bounded handoff adapter." });
  }
}
