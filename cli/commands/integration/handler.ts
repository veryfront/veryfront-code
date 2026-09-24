import { createIntegrationErrorContext } from "#veryfront/integrations/error-context.ts";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";
import { resolveManagementConfigNoModule } from "#cli/shared/config";
import { projectApiReference } from "#cli/shared/project-resolution";
import { getEnvironmentConfig } from "veryfront/config";
import { createIntegrationClient, IntegrationApiError } from "veryfront/integrations";
import { defineError, INVALID_ARGUMENT } from "veryfront/errors";
import { exitProcess, registerTerminationSignals } from "#cli/utils";
import {
  createSuccessEnvelope,
  getOutputPath,
  isJsonMode,
  outputJson,
} from "../../shared/json-output.ts";
import {
  parseIntegrationArgs,
  requireIntegrationTarget,
  runIntegrationOperation,
} from "./command.ts";
import { connectIntegration, type IntegrationConnectDependencies } from "./connect.ts";

const INTEGRATION_INTERRUPTED = defineError({
  slug: "integration-operation-interrupted",
  category: "RUNTIME",
  status: 499,
  title: "Integration operation interrupted",
  exitCode: 130,
});

export interface IntegrationCommandDependencies extends IntegrationConnectDependencies {
  resolveConfig?: typeof resolveManagementConfigNoModule;
  createClient?: typeof createIntegrationClient;
  registerSignals?: typeof registerTerminationSignals;
  exit?: (code: number) => void;
}
export async function handleIntegrationCommand(
  args: ParsedArgs,
  dependencies: IntegrationCommandDependencies = {},
): Promise<void> {
  const options = parseArgsOrThrow(parseIntegrationArgs, "integration", args);
  if (args._.length > (options.subcommand === "list" ? 2 : 3)) {
    throw INVALID_ARGUMENT.create({
      detail: "Unexpected positional arguments. See veryfront integration --help.",
    });
  }
  if (options.subcommand !== "list") requireIntegrationTarget(options);
  if (options.subcommand === "connect" && options.noBrowser && getOutputPath()) {
    throw INVALID_ARGUMENT.create({
      detail:
        "Headless connection handoffs cannot use --output; the ephemeral URL is returned only to the invoking terminal.",
    });
  }
  const allowed = (present: boolean, commands: string[], flag: string) => {
    if (present && !commands.includes(options.subcommand)) {
      throw INVALID_ARGUMENT.create({
        detail: `${flag} is not supported by this integration operation.`,
      });
    }
  };
  allowed(options.connectionId !== undefined, ["call", "status"], "--connection");
  allowed(options.expectedConnectionGenerationId !== undefined, ["call"], "--expected-generation");
  if (options.expectedConnectionGenerationId !== undefined && options.connectionId === undefined) {
    throw INVALID_ARGUMENT.create({ detail: "--expected-generation requires --connection." });
  }
  allowed(options.argumentsJson !== undefined, ["call"], "--args");
  allowed(options.search !== undefined, ["list", "tools"], "--search");
  allowed(options.noBrowser || options.redirectUri !== undefined || args.timeout !== undefined, [
    "connect",
  ], "Connect options");
  allowed(args.scope !== undefined, ["connect", "status"], "--scope");
  const controller = new AbortController();
  let userInterrupted = false;
  const dispose = (dependencies.registerSignals ?? registerTerminationSignals)((signal) => {
    if (signal === "SIGINT") userInterrupted = true;
    controller.abort(new DOMException("Integration operation cancelled", "AbortError"));
  });
  try {
    const env = getEnvironmentConfig();
    const config = await (dependencies.resolveConfig ?? resolveManagementConfigNoModule)(
      options.projectDir,
      { ...env, ...(options.projectReference ? { projectSlug: options.projectReference } : {}) },
    );
    const client = await (dependencies.createClient ?? createIntegrationClient)({
      apiBaseUrl: config.apiUrl,
      authToken: config.apiToken,
      projectReference: options.projectReference ?? projectApiReference(config),
      abortSignal: controller.signal,
    });
    const result = options.subcommand === "connect"
      ? await connectIntegration(client, options, dependencies, controller.signal)
      : await runIntegrationOperation(options, client);
    controller.signal.throwIfAborted();
    if (
      result && typeof result === "object" && "status" in result && result.status === "tool_error"
    ) {
      const envelope = {
        success: false as const,
        command: "integration",
        error: {
          code: "INTEGRATION_TOOL_ERROR",
          slug: "integration-tool-error",
          message: "The integration tool returned an error.",
        },
        data: result,
      };
      if (isJsonMode()) await outputJson(envelope);
      else console.log(JSON.stringify(envelope, null, 2));
      (dependencies.exit ?? exitProcess)(1);
      return;
    }
    if (isJsonMode()) await outputJson(createSuccessEnvelope("integration", result));
    else console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (!userInterrupted) throw error;
    // Keep only validated outcome facts. Native Problem/consent data and causes
    // must not enter CLI diagnostics when a user cancels the operation.
    throw INTEGRATION_INTERRUPTED.create({
      context: createIntegrationErrorContext({
        interrupted: true,
        outcomeUnknown: error instanceof IntegrationApiError && error.outcomeUnknown,
      }),
    });
  } finally {
    dispose();
  }
}
