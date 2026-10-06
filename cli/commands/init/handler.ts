/**
 * Init Command Handler
 *
 * Handles argument parsing and config file loading for the init command.
 */

import { createFileSystem } from "veryfront/platform";
import { defineSchema, lazySchema } from "veryfront/schemas";
import { cliLogger, exitProcess } from "#cli/utils";
import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { resolvePath } from "./path-utils.ts";
import { initCommand } from "./init-command.ts";
import type { ParsedArgs } from "#cli/shared/types";
import type { InitRuntime, InitTemplate } from "./types.ts";
import { parseRuntime } from "./runtime.ts";
import type { IntegrationName } from "../../../templates/types.ts";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  isJsonMode,
  outputJson,
} from "../../shared/json-output.ts";
import { DEFAULT_TEMPLATE } from "./catalog.ts";

const getInitArgsSchema = defineSchema((v) =>
  v.object({
    name: v.string().optional(),
    template: v.string().optional(),
    runtime: v.string().optional(),
    integrations: v.string().optional(),
    skipInstall: v.boolean().default(false),
    skipEnvPrompt: v.boolean().default(false),
    deploy: v.boolean().default(false),
    force: v.boolean().default(false),
    config: v.string().optional(),
  })
);

const InitArgsSchema = lazySchema(getInitArgsSchema);

export const parseInitArgs = createArgParser(InitArgsSchema, {
  name: { keys: ["name"], type: "string", positional: 0 },
  template: { keys: ["template", "t"], type: "string" },
  runtime: { keys: ["runtime"], type: "string" },
  integrations: { keys: ["integrations"], type: "string" },
  skipInstall: { keys: ["skip-install"], type: "boolean" },
  skipEnvPrompt: { keys: ["skip-env-prompt"], type: "boolean" },
  deploy: { keys: ["deploy"], type: "boolean" },
  force: CommonArgs.force,
  config: { keys: ["config", "c"], type: "string" },
}, { rejectUnknown: true });

/**
 * Handle the init command with argument parsing and config file support
 */
export async function handleInitCommand(args: ParsedArgs): Promise<void> {
  const parsedArgs = parseArgsOrThrow(parseInitArgs, "init", args);
  const jsonOutput = isJsonMode();
  const nonInteractive = args.yes === true || args.y === true || args["no-input"] === true ||
    jsonOutput;
  let name = parsedArgs.name;
  let template = parsedArgs.template as InitTemplate | undefined;
  let integrations: IntegrationName[] | undefined;
  let skipInstall = parsedArgs.skipInstall;
  let skipEnvPrompt = parsedArgs.skipEnvPrompt || nonInteractive;
  let env: Record<string, string> | undefined;
  const deploy = parsedArgs.deploy;
  const force = parsedArgs.force;
  let runtime: InitRuntime | undefined = parsedArgs.runtime !== undefined
    ? parseRuntime(parsedArgs.runtime)
    : undefined;

  // Load config file if provided
  const configPath = parsedArgs.config;
  if (configPath) {
    const fs = createFileSystem();
    const resolvedPath = resolvePath(String(configPath));

    try {
      const configContent = await fs.readTextFile(resolvedPath);
      const config = JSON.parse(configContent) as {
        name?: string;
        template?: InitTemplate;
        integrations?: IntegrationName[];
        skipInstall?: boolean;
        skipEnvPrompt?: boolean;
        env?: Record<string, string>;
        runtime?: unknown;
      };

      // Config values serve as defaults, CLI args take precedence
      name ||= config.name;
      template ||= config.template;
      integrations ||= config.integrations;
      skipInstall ||= config.skipInstall ?? false;
      skipEnvPrompt ||= config.skipEnvPrompt ?? false;
      env = config.env;
      if (runtime === undefined && config.runtime !== undefined) {
        runtime = parseRuntime(config.runtime);
      }

      cliLogger.debug(`Loaded config from ${resolvedPath}`);
    } catch (error) {
      const detail = error instanceof SyntaxError
        ? "Invalid JSON syntax in config file"
        : "Could not read file";
      throw new Error(`Failed to read config file: ${resolvedPath} (${detail})`);
    }
  }

  // Parse integrations from CLI args
  if (parsedArgs.integrations) {
    integrations = parsedArgs.integrations
      .split(",")
      .map((s) => s.trim()) as IntegrationName[];
  }
  skipEnvPrompt ||= nonInteractive;
  if (jsonOutput && template === undefined) {
    template = DEFAULT_TEMPLATE;
  }

  const result = await initCommand({
    name,
    template,
    skipInstall,
    skipEnvPrompt,
    integrations,
    env,
    deploy,
    force,
    runtime,
    quiet: jsonOutput,
    includePackageMetadata: jsonOutput ? true : undefined,
  });

  if (jsonOutput) {
    if (!result.cancelled && result.deployment.status === "failed") {
      await outputJson(createErrorEnvelope("init", {
        code: "DEPLOYMENT_FAILED",
        slug: "deployment-failed",
        message: result.deployment.message,
        context: { localProject: result },
      }));
      exitProcess(1);
      return;
    }

    await outputJson(createSuccessEnvelope("init", result));
  }
}
