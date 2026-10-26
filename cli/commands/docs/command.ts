import denoConfig from "../../../deno.json" with { type: "json" };
import { readGlobalBooleanFlag } from "../../shared/global-flags.ts";
import { docsHelp } from "./command-help.ts";

export const DOCUMENTATION_URL = "https://veryfront.com/docs/code";

interface DocsDependencies {
  open: (url: string) => Promise<void>;
  print: (text: string) => void;
  warn: (text: string) => void;
}

async function openDocumentation(url: string): Promise<void> {
  const { openBrowser } = await import("../../auth/browser.ts");
  // A bounded launch observes unsuccessful exit codes as well as missing openers.
  await openBrowser(url, { timeoutMs: 5_000 });
}

function parseDocsArguments(args: readonly string[]) {
  const terminator = args.indexOf("--");
  const positionals = terminator < 0 ? [] : args.slice(terminator + 1);
  if (terminator >= 0) args = args.slice(0, terminator);
  return { positionals, ...parseDocsOptions(args) };
}

function parseDocsOptions(args: readonly string[]) {
  const booleanFlags = new Map<string, boolean>();
  let output: string | undefined;
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--output" || arg === "-o") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) remaining.push(arg);
      else {
        output = value;
        index++;
      }
      continue;
    }
    if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
      if (!output) remaining.push(arg);
      continue;
    }
    {
      const flag = readGlobalBooleanFlag(arg);
      if (flag) booleanFlags.set(flag.name, flag.value);
      else remaining.push(arg);
    }
  }
  return { booleanFlags, output, remaining };
}

async function emitDocsOutput(
  value: string,
  output: string | undefined,
  json: boolean,
  dependencies: DocsDependencies,
): Promise<boolean> {
  try {
    if (output) {
      const { dirname } = await import("node:path");
      await Deno.mkdir(dirname(output), { recursive: true });
      await Deno.writeTextFile(output, value + "\n");
    }
  } catch {
    const message = "Unable to write the documentation command output file.";
    if (json) {
      dependencies.print(
        JSON.stringify({
          success: false,
          command: "docs",
          error: {
            code: "OUTPUT_WRITE_FAILED",
            slug: "output-write-failed",
            message,
          },
        }),
      );
    } else dependencies.warn(message);
    return false;
  }
  dependencies.print(value);
  return true;
}

async function reportInvalidArgument(
  invalid: string,
  json: boolean,
  emit: (value: string) => Promise<boolean>,
  dependencies: DocsDependencies,
): Promise<number> {
  const option = /^(--?[a-z][a-z0-9-]*)(?:=|$)/i.exec(invalid)?.[1];
  const message = option ? `Unknown docs option: ${option}` : "Unknown docs argument.";
  if (json) {
    const written = await emit(
      JSON.stringify({
        success: false,
        command: "docs",
        error: { code: "USAGE_ERROR", slug: "invalid-arguments", message },
      }),
    );
    if (!written) return 1;
  } else dependencies.warn(`${message}\n${docsHelp.usage}`);
  return 2;
}

function versionOutput(json: boolean): string {
  return json
    ? JSON.stringify({
      success: true,
      command: "version",
      data: {
        version: denoConfig.version,
        deno: Deno.version.deno,
        v8: Deno.version.v8,
        typescript: Deno.version.typescript,
        os: Deno.build.os,
        arch: Deno.build.arch,
        standalone: Deno.build.standalone ?? false,
      },
    })
    : `Veryfront CLI v${denoConfig.version}`;
}

/** No project discovery, environment loading, authentication, or server startup. */
export async function runDocsCommand(
  args: readonly string[],
  deps?: DocsDependencies,
): Promise<number> {
  const dependencies = deps === undefined
    ? { open: openDocumentation, print: console.log, warn: console.error }
    : deps;
  const { positionals, booleanFlags, output, remaining } = parseDocsArguments(
    args,
  );
  const json = booleanFlags.get("json") === true;
  const emit = (value: string) => emitDocsOutput(value, output, json, dependencies);
  const invalid = positionals[0] ?? remaining[0];
  if (invalid !== undefined) {
    return await reportInvalidArgument(invalid, json, emit, dependencies);
  }
  if (booleanFlags.get("version")) {
    const written = await emit(
      versionOutput(json),
    );
    return written ? 0 : 1;
  }
  if (booleanFlags.get("help")) {
    const written = await emit(
      json
        ? JSON.stringify({
          success: true,
          command: "help",
          data: { topic: "docs", help: docsHelp },
        })
        : `${docsHelp.description}\n\n${docsHelp.usage}\n\n--json  Print the URL without opening a browser.\n\nWorks without a project or Veryfront account.`,
    );
    return written ? 0 : 1;
  }
  if (json) {
    const written = await emit(
      JSON.stringify({
        success: true,
        command: "docs",
        data: { url: DOCUMENTATION_URL },
      }),
    );
    return written ? 0 : 1;
  }
  if (!await emit(DOCUMENTATION_URL)) return 1;
  try {
    await dependencies.open(DOCUMENTATION_URL);
  } catch {
    dependencies.warn(
      "Unable to open a browser. Open the URL above to read the documentation.",
    );
  }
  return 0;
}
