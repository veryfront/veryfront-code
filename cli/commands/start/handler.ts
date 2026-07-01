import { defineSchema, lazySchema } from "veryfront/schemas";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";
import type { ParsedArgs } from "#cli/shared/types";

const DEFAULT_START_PORT = 8080;

const getStartArgsSchema = defineSchema((v) =>
  v.object({
    port: v.number().default(DEFAULT_START_PORT),
    project: v.string().optional(),
    headless: v.boolean().default(false),
  })
);

const StartArgsSchema = lazySchema(getStartArgsSchema);

export const parseStartArgs = createArgParser(StartArgsSchema, {
  port: { keys: ["port", "p"], type: "number" },
  project: { keys: ["project"], type: "string" },
  headless: { keys: ["headless", "no-tui"], type: "boolean" },
});

export async function handleStartCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseStartArgs, "start", args);
  await ensureCliBundlerContracts();
  const { startCommand } = await import("./command.ts");
  await startCommand({
    port: opts.port,
    projectPath: opts.project ?? null,
    headless: opts.headless,
  });
}
