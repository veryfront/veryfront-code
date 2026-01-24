/****
 * Dev Command - Development server with HMR
 */

import { compileAllMDX, watchMDX } from "#veryfront/build/compiler/mdx-compiler/index.ts";
import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { getConfig } from "#veryfront/config";
import { getRuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { createDevServer } from "#veryfront/server/dev-server.ts";
import { runAIConfigValidation } from "../discovery/config-validator.ts";
import { discoverAll } from "../discovery/index.ts";
import { exitProcess, registerTerminationSignals } from "../utils/index.ts";
import { banner } from "../ui/components/banner.ts";
import { brand, dim, success } from "../ui/colors.ts";
import { createKeyboardHandler, type KeyboardHandler } from "../ui/keyboard.ts";
import { openBrowser } from "../auth/browser.ts";
import { createMCPServer, type MCPDevServer } from "../mcp/server.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export interface DevOptions {
  port: number;
  projectDir: string;
  hmr?: boolean;
  /** Demo mode: don't exit process on shutdown, resolve done promise instead */
  demoMode?: boolean;
}

export type DevCommandOptions = DevOptions;

export interface DevCommandResult {
  ready: Promise<void>;
  done: Promise<void>;
  /** Stop the dev server programmatically (for demo mode) */
  stop: () => Promise<void>;
}

export function devCommand(options: DevOptions): Promise<DevCommandResult> {
  return withSpan(
    "cli.command.dev",
    async () => {
      const { port, projectDir, hmr = true, demoMode = false } = options;

      let doneResolve: (() => void) | undefined;
      const done = new Promise<void>((resolve) => {
        doneResolve = resolve;
      });

      const adapter = await runtime.get();

      let config: Awaited<ReturnType<typeof getConfig>>;
      try {
        config = await getConfig(projectDir, adapter);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw new VeryfrontError("No veryfront.config.js found", ErrorCode.CONFIG_ERROR, {
            projectDir,
          });
        }
        throw error;
      }

      const DEFAULT_DEV_PORT = 3000;
      const finalPort = port !== DEFAULT_DEV_PORT ? port : (config?.dev?.port ?? port);
      const enableHMR = config?.dev?.hmr !== false && hmr;

      const env = getRuntimeEnv();
      const isProxyMode = config?.fs?.veryfront?.proxyMode === true;
      const projectSlug = config?.fs?.veryfront?.projectSlug ?? env.projectSlug;

      if (config) runAIConfigValidation(config);

      try {
        await discoverAll({ baseDir: projectDir, verbose: false });
      } catch {
        // AI discovery skipped
      }

      if (config?.experimental?.precompileMDX) {
        const outputDir = join(projectDir, ".veryfront", "compiled");
        try {
          await compileAllMDX({ projectDir, outputDir, mode: "development" });
          void watchMDX({ projectDir, outputDir, mode: "development" });
        } catch {
          // MDX pre-compilation failed
        }
      }

      const shutdownController = new AbortController();
      let devServer: Awaited<ReturnType<typeof createDevServer>> | null = null;
      let mcpServer: MCPDevServer | null = null;

      try {
        devServer = await createDevServer({
          port: finalPort,
          projectDir,
          hmrPort: finalPort + 1,
          enableHMR,
          enableFastRefresh: true,
          signal: shutdownController.signal,
        });
      } catch (error) {
        if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          if (msg.includes("eaddrinuse") || msg.includes("address already in use")) {
            throw new VeryfrontError(
              `Port ${finalPort} is already in use`,
              ErrorCode.INITIALIZATION_ERROR,
              { port: finalPort },
            );
          }
        }
        throw error;
      }

      const mcpPort = finalPort + 2;
      try {
        mcpServer = await createMCPServer({ httpPort: mcpPort });
      } catch {
        // MCP server failed to start - non-fatal, continue without it
      }

      let keyboardHandler: KeyboardHandler | null = null;
      let shuttingDown = false;

      async function shutdown(): Promise<void> {
        if (shuttingDown) {
          if (!demoMode) exitProcess(0);
          return;
        }
        shuttingDown = true;

        const timeout = demoMode ? null : setTimeout(() => exitProcess(0), 3000);

        try {
          keyboardHandler?.stop();
          shutdownController.abort();
          await mcpServer?.stop();
          await devServer?.stop();
        } catch {
          // ignore
        } finally {
          if (timeout) clearTimeout(timeout);
        }

        if (demoMode) {
          doneResolve?.();
          return;
        }

        exitProcess(0);
      }

      registerTerminationSignals(() => void shutdown());

      if (!isProxyMode) {
        const serverUrl = `http://lvh.me:${finalPort}`;

        console.log();
        console.log(
          banner({
            title: "Veryfront",
            subtitle: "is now running",
            info: {
              url: serverUrl,
              ...(projectSlug ? { project: projectSlug } : {}),
              ...(mcpServer ? { mcp: `http://localhost:${mcpPort}` } : {}),
            },
          }),
        );
        console.log();
        console.log(`  ${success("✓")} Server ready`);
        if (mcpServer) {
          console.log(
            `  ${success("✓")} MCP ready ${dim(`(coding agents can connect to port ${mcpPort})`)}`,
          );
        }
        console.log();
        console.log(`  ${dim("Shortcuts:")}`);
        console.log(`    ${brand("o")}  ${dim("open in browser")}`);
        console.log(`    ${brand("c")}  ${dim("clear console")}`);
        console.log(`    ${brand("q")}  ${dim("quit")}`);
        console.log();

        if (!demoMode) {
          keyboardHandler = createKeyboardHandler({
            onOpen: () => void openBrowser(serverUrl),
            onClear: () => console.clear(),
            onQuit: () => void shutdown(),
          });
          keyboardHandler.start();
        }
      }

      return {
        ready: devServer.ready,
        done,
        stop: shutdown,
      };
    },
    {
      "cli.port": options.port,
      "cli.projectDir": options.projectDir,
      "cli.hmr": options.hmr ?? true,
    },
  );
}
