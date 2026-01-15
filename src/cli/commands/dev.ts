/**
 * Dev Command - Development server with HMR
 */

import { compileAllMDX, watchMDX } from "@veryfront/build/compiler/mdx-compiler/index.ts";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { getEnv } from "@veryfront/platform/compat/process.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { getConfig } from "@veryfront/config";
import { createDevServer } from "@veryfront/server/dev-server.ts";
import { runAIConfigValidation } from "@veryfront/ai/utils/config-validator.ts";
import { discoverAll } from "@veryfront/ai/utils/discovery.ts";
import { exitProcess, registerTerminationSignals } from "../utils/index.ts";
import { banner } from "../ui/components/banner.ts";
import { brand, dim, success } from "../ui/colors.ts";
import { createKeyboardHandler, type KeyboardHandler } from "../ui/keyboard.ts";

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

export async function devCommand(options: DevOptions): Promise<DevCommandResult> {
  const { port, projectDir, hmr = true, demoMode = false } = options;

  // Create resolvable done promise for demo mode
  let doneResolve: (() => void) | null = null;
  const donePromise = new Promise<void>((resolve) => {
    doneResolve = resolve;
  });

  const adapter = await getAdapter();

  // Load config
  let config;
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
  const finalPort = port !== DEFAULT_DEV_PORT ? port : (config?.dev?.port || port);
  const enableHMR = config?.dev?.hmr !== false && hmr;
  // Check both config and env var for proxy mode (dev-proxy.ts sets PROXY_MODE env var)
  const isProxyMode = config?.fs?.veryfront?.proxyMode === true || getEnv("PROXY_MODE") === "1";
  const projectSlug = config?.fs?.veryfront?.projectSlug || getEnv("VERYFRONT_PROJECT_SLUG");

  // Validate AI configuration
  if (config) {
    runAIConfigValidation(config);
  }

  // Auto-discover AI components
  try {
    await discoverAll({ baseDir: projectDir, verbose: false });
  } catch {
    // AI discovery skipped
  }

  // Pre-compile MDX if enabled
  if (config?.experimental?.precompileMDX) {
    const outputDir = join(projectDir, ".veryfront", "compiled");
    try {
      await compileAllMDX({ projectDir, outputDir, mode: "development" });
      void watchMDX({ projectDir, outputDir, mode: "development" });
    } catch {
      // MDX pre-compilation failed
    }
  }

  // Start dev server
  const shutdownController = new AbortController();
  let devServer: Awaited<ReturnType<typeof createDevServer>> | null = null;

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

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      if (!demoMode) exitProcess(0);
      return;
    }
    shuttingDown = true;

    const timeout = demoMode ? null : setTimeout(() => exitProcess(0), 3000);
    try {
      shutdownController.abort();
      await devServer?.stop();
    } catch { /* ignore */ }
    if (timeout) clearTimeout(timeout);

    // In demo mode, resolve the done promise instead of exiting
    if (demoMode) {
      doneResolve?.();
    } else {
      exitProcess(0);
    }
  };

  registerTerminationSignals(() => void shutdown());

  // Keyboard handler for shortcuts
  let keyboardHandler: KeyboardHandler | null = null;

  // Open browser helper
  const openBrowser = async (url: string) => {
    try {
      if (typeof Deno !== "undefined") {
        const [command, ...args] = Deno.build.os === "darwin"
          ? ["open", url]
          : Deno.build.os === "windows"
          ? ["cmd", "/c", "start", url]
          : ["xdg-open", url];
        if (command) {
          await new Deno.Command(command, { args }).spawn().status;
        }
      } else if (typeof globalThis.process !== "undefined") {
        const { exec } = await import("node:child_process");
        const platform = globalThis.process.platform;
        const cmd = platform === "darwin"
          ? `open "${url}"`
          : platform === "win32"
          ? `start "${url}"`
          : `xdg-open "${url}"`;
        exec(cmd);
      }
    } catch {
      // Failed to open browser
    }
  };

  // Startup banner (skip in proxy mode - proxy handles banner)
  if (!isProxyMode) {
    const serverUrl = `http://lvh.me:${finalPort}`;

    console.log();
    console.log(banner({
      title: "Veryfront",
      subtitle: "is now running",
      info: {
        url: serverUrl,
        ...(projectSlug ? { project: projectSlug } : {}),
      },
    }));
    console.log();
    console.log(`  ${success("✓")} Server ready`);
    console.log();
    console.log(`  ${dim("Shortcuts:")}`);
    console.log(`    ${brand("o")}  ${dim("open in browser")}`);
    console.log(`    ${brand("c")}  ${dim("clear console")}`);
    console.log(`    ${brand("q")}  ${dim("quit")}`);
    console.log();

    // Set up keyboard shortcuts (only in non-demo mode with TTY)
    if (!demoMode) {
      keyboardHandler = createKeyboardHandler({
        onOpen: () => void openBrowser(serverUrl),
        onClear: () => console.clear(),
        onQuit: () => void shutdown(),
      });
      keyboardHandler.start();
    }
  }

  // Cleanup keyboard handler on shutdown
  const originalShutdown = shutdown;
  const shutdownWithKeyboard = async () => {
    keyboardHandler?.stop();
    await originalShutdown();
  };

  return {
    ready: devServer.ready,
    done: donePromise,
    stop: shutdownWithKeyboard,
  };
}
