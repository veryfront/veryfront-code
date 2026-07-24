/**
 * Minimal error reporting for failures that happen before CLI routing starts.
 *
 * This module intentionally has no framework imports. Environment loading can
 * fail before the normal CLI error boundary is available, so the output must
 * stay deterministic and must not render the original throwable.
 */

export const CLI_ENVIRONMENT_STARTUP_MESSAGE =
  "Veryfront could not load environment files. Check .env syntax and file permissions, then try again.";

const CLI_EARLY_DIAGNOSTICS_NOTE =
  "Early startup details were suppressed to protect environment data.";

export interface CliEnvironmentStartupFailure {
  readonly destination: "stdout" | "stderr";
  readonly text: string;
}

export interface CliEnvironmentStartupFailureOptions {
  /** Host debug mode captured before environment-file loading begins. */
  readonly debug?: boolean;
}

const FALSE_FLAG_VALUES = new Set(["", "0", "false", "no", "off"]);
const TRUE_ENV_VALUES = new Set(["1", "true", "yes"]);

/** Match the framework-wide truthy environment-value contract. */
export function isCliStartupDebugEnabled(
  value: string | undefined,
): boolean {
  return value !== undefined &&
    TRUE_ENV_VALUES.has(value.trim().toLowerCase());
}

interface CliStartupOutputMode {
  readonly diagnostics: boolean;
  readonly json: boolean;
}

function parseFlagValue(arg: string, name: string): boolean | undefined {
  const prefix = `--${name}=`;
  if (!arg.startsWith(prefix)) return undefined;
  const value = arg.slice(prefix.length).trim().toLowerCase();
  return !FALSE_FLAG_VALUES.has(value);
}

function parseCliStartupOutputMode(
  args: readonly string[],
  debug: boolean,
): CliStartupOutputMode {
  let json = false;
  let verbose = false;

  for (const arg of args) {
    if (arg === "--") break;

    if (arg === "--json" || arg === "-j") {
      json = true;
      continue;
    }

    const jsonValue = parseFlagValue(arg, "json");
    if (jsonValue !== undefined) {
      json = jsonValue;
      continue;
    }

    if (arg === "--verbose") {
      verbose = true;
      continue;
    }

    const verboseValue = parseFlagValue(arg, "verbose");
    if (verboseValue !== undefined) {
      verbose = verboseValue;
    }
  }

  return { diagnostics: debug || verbose, json };
}

/**
 * Format an environment startup failure without inspecting the throwable.
 *
 * Ignoring the original value is deliberate: parser, filesystem, and runtime
 * errors can contain secrets, absolute paths, or stacks before sanitizers load.
 */
export function formatCliEnvironmentStartupFailure(
  args: readonly string[],
  options: CliEnvironmentStartupFailureOptions = {},
): CliEnvironmentStartupFailure {
  const mode = parseCliStartupOutputMode(args, options.debug === true);

  if (mode.json) {
    const context = mode.diagnostics ? { diagnostics: CLI_EARLY_DIAGNOSTICS_NOTE } : undefined;
    return {
      destination: "stdout",
      text: JSON.stringify(
        {
          success: false,
          command: "cli",
          error: {
            code: "CONFIG_ERROR",
            slug: "environment-load-failed",
            message: CLI_ENVIRONMENT_STARTUP_MESSAGE,
            ...(context ? { context } : {}),
          },
        },
        null,
        2,
      ),
    };
  }

  return {
    destination: "stderr",
    text: mode.diagnostics
      ? `Error: ${CLI_ENVIRONMENT_STARTUP_MESSAGE}\n${CLI_EARLY_DIAGNOSTICS_NOTE}`
      : `Error: ${CLI_ENVIRONMENT_STARTUP_MESSAGE}`,
  };
}

/** Write the pre-routing failure to its contractually correct stream. */
export function reportCliEnvironmentStartupFailure(
  args: readonly string[],
  options: CliEnvironmentStartupFailureOptions = {},
): void {
  const failure = formatCliEnvironmentStartupFailure(args, options);
  if (failure.destination === "stdout") {
    console.log(failure.text);
    return;
  }
  console.error(failure.text);
}
