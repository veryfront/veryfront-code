import { VERSION } from "@veryfront/utils";
import { bold, cyan, dim, yellow } from "@veryfront/compat/console";
import { cliLogger } from "@veryfront/utils";
import { exit } from "../../platform/compat/process.ts";
import { isDeno } from "../../platform/compat/runtime.ts";

// Logo and help display
export function showLogo() {
  cliLogger.info(`
${cyan("⚡")} ${bold(cyan("Veryfront"))} ${dim(`v${VERSION}`)}
${dim("──────────────────────")}
`);
}

export function showHelp() {
  showLogo();
  cliLogger.info(`
${yellow("Usage:")} veryfront <command> [options]

${cyan("Commands:")}
  init          Initialize a new Veryfront project
    -t, --template <name>  Template: app-router | app-router-api | pages-router | rsc-demo (default: pages-router)
  dev           Start development server
  build         Build for production
  serve         Start universal production server (no build required)
                 - Honors security.cors (CORS for API routes)
                 - Merges CSP with nonce per request
                 - Exposes /_metrics (requests, SSR, cache, RSC)
                 - Optional Redis cache via VERYFRONT_USE_REDIS_CACHE=1

  doctor        Check system requirements
               --strict, -s    Treat warnings as failures
  clean         Clean build cache

  routes        Print discovered routes (pages + API)
                --json, -j      Output JSON
  generate, g   Generate scaffolds (page|layout|provider|api|rsc)

${cyan("Options:")}
  --version     Show version information
  --help        Show this help message

${cyan("Examples:")}
  veryfront init my-app -t app-router
  veryfront init my-app-api -t app-router-api
  veryfront dev --port 3000
  veryfront build --minify
  veryfront build --no-ssg            # disable static site generation
  veryfront build --include /docs --exclude /blog
  veryfront build --dry-run           # list SSG routes without writing files
  # HMR: browser reloads on file save; logs show ws path

  veryfront routes
  veryfront generate api users/[id]
  # Production server (CSP/CORS, APIs, RSC)
  veryfront serve --port 3000
  # With Redis cache adapter enabled
  VERYFRONT_USE_REDIS_CACHE=1 veryfront serve --port 3000
  # Try experimental RSC demo template (RSC is behind a flag)
  veryfront init my-rsc-app -t rsc-demo && (cd my-rsc-app && VERYFRONT_EXPERIMENTAL_RSC=1 veryfront dev)
  # RSC production server (preview)
  VERYFRONT_EXPERIMENTAL_RSC=1 deno run -A src/server/production-server.ts

${cyan("Config tips:")}
  // veryfront.config.js
  export default {
    generate: { preferredRouter: "app-router" },
    security: { remoteHosts: ["https://esm.sh", "https://deno.land"] }
  }

${cyan("Docs:")}
  RSC Security & Actions: docs/RSC_SECURITY_AND_ACTIONS.md
  Server Actions: docs/server-actions.md
  Caching: docs/caching.md
  Security (CSP/CORS): docs/security.md
  Migration (Beta→v1): MIGRATION.md

Version: ${VERSION}
`);
}

export function showVersion() {
  cliLogger.info(`Veryfront v${VERSION}`);
}

// Logging utilities
export function logSuccess(message: string) {
  cliLogger.info(`✅ ${message}`);
}

export function logError(message: string) {
  console.error(`❌ ${message}`);
}

export function logWarning(message: string) {
  console.warn(`⚠️  ${message}`);
}

export function logInfo(message: string) {
  cliLogger.info(`ℹ️  ${message}`);
}

/**
 * Register handlers for termination signals in both Node/Bun and Deno runtimes.
 * Returns a cleanup function to remove listeners.
 */
export function registerTerminationSignals(
  handler: (signal: "SIGINT" | "SIGTERM") => void | Promise<void>,
): () => void {
  const cleanupFns: Array<() => void> = [];
  const signals: Array<"SIGINT" | "SIGTERM"> = ["SIGINT", "SIGTERM"];

  for (const signal of signals) {
    // Deno (with Node compat available)
    if (typeof Deno !== "undefined" && "addSignalListener" in Deno) {
      const listener = () => {
        void handler(signal);
      };
      // @ts-ignore - Deno types are available at runtime when using Deno
      Deno.addSignalListener(signal, listener);
      cleanupFns.push(() => {
        try {
          // @ts-ignore - optional on older Deno versions
          Deno.removeSignalListener?.(signal, listener);
        } catch {
          /* ignore */
        }
      });
      continue;
    }

    // Node/Bun
    if (typeof process !== "undefined" && typeof process.on === "function") {
      const listener = () => {
        void handler(signal);
      };
      process.on(signal, listener);
      cleanupFns.push(() => {
        try {
          if (typeof process.off === "function") {
            process.off(signal, listener);
          } else {
            // @ts-ignore - removeListener exists on Node process
            process.removeListener?.(signal, listener);
          }
        } catch {
          /* ignore */
        }
      });
    }
  }

  return () => {
    for (const cleanup of cleanupFns) {
      cleanup();
    }
  };
}

// User interaction
export async function promptUser(message: string): Promise<string> {
  cliLogger.info(message);

  if (isDeno) {
    // Deno-specific stdin reading
    const buf = new Uint8Array(1024);
    // @ts-ignore - Deno global
    const n = await Deno.stdin.read(buf);
    if (n === null) {
      return "";
    }
    const input = new TextDecoder().decode(buf.subarray(0, n));
    return input.trim();
  } else {
    // Node.js/Bun fallback using readline
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question("", (answer: string) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }
}

// Process utilities
/**
 * Exit the process with a given code
 * @param code - Exit code
 */
export function exitProcess(code: number): void {
  exit(code);
}

// Re-export formatBytes from shared format utils for backward compatibility
export { formatBytes } from "@veryfront/utils";
