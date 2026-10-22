import denoConfig from "../../../deno.json" with { type: "json" };
import {
  CLI_FLAG_ALIASES,
  GLOBAL_BOOLEAN_FLAGS,
  readGlobalBooleanFlag,
} from "../../shared/global-flags.ts";
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

/** No project discovery, environment loading, authentication, or server startup. */
export async function runDocsCommand(
  args: readonly string[],
  deps: DocsDependencies = { open: openDocumentation, print: console.log, warn: console.error },
): Promise<number> {
  args = args.flatMap((argument) => {
    const flag = readGlobalBooleanFlag(argument);
    return flag ? flag.value ? [`--${flag.name}`] : [] : [argument];
  });
  const json = args.includes("--json") || args.includes("-j");
  let output: string | undefined;
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--output" || arg === "-o") {
      const value = args[++index];
      if (!value || value.startsWith("-")) remaining.push(arg);
      else output = value;
    } else if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
      if (!output) remaining.push(arg);
    } else remaining.push(arg);
  }
  async function emit(value: string): Promise<boolean> {
    try {
      if (output) {
        const { dirname } = await import("node:path");
        await Deno.mkdir(dirname(output), { recursive: true });
        await Deno.writeTextFile(output, value + "\n");
      }
    } catch {
      const message = "Unable to write the documentation command output file.";
      if (json) {
        deps.print(
          JSON.stringify({
            success: false,
            command: "docs",
            error: { code: "OUTPUT_WRITE_FAILED", slug: "output-write-failed", message },
          }),
        );
      } else deps.warn(message);
      return false;
    }
    deps.print(value);
    return true;
  }
  const invalid = remaining.find((arg) => {
    const flag = arg.startsWith("--") ? arg.slice(2) : CLI_FLAG_ALIASES[arg.slice(1)];
    return !flag || !GLOBAL_BOOLEAN_FLAGS.has(flag);
  });
  if (invalid) {
    const message = `Unknown docs argument: ${invalid}`;
    if (json) {
      const written = await emit(
        JSON.stringify({
          success: false,
          command: "docs",
          error: { code: "USAGE_ERROR", slug: "invalid-arguments", message },
        }),
      );
      if (!written) return 1;
    } else deps.warn(`${message}\n${docsHelp.usage}`);
    return 2;
  }
  if (args.includes("--version") || args.includes("-v")) {
    const written = await emit(
      json
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
        : `Veryfront CLI v${denoConfig.version}`,
    );
    return written ? 0 : 1;
  }
  if (args.includes("--help") || args.includes("-h")) {
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
      JSON.stringify({ success: true, command: "docs", data: { url: DOCUMENTATION_URL } }),
    );
    return written ? 0 : 1;
  }
  if (!await emit(DOCUMENTATION_URL)) return 1;
  try {
    await deps.open(DOCUMENTATION_URL);
  } catch {
    deps.warn("Unable to open a browser. Open the URL above to read the documentation.");
  }
  return 0;
}
