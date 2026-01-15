/**
 * Dev Command - Development server with HMR
 */

import { compileAllMDX, watchMDX } from "@veryfront/build/compiler/mdx-compiler/index.ts";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { getConfig } from "@veryfront/config";
import { createDevServer } from "@veryfront/server/dev-server.ts";
import { runAIConfigValidation } from "@veryfront/ai/utils/config-validator.ts";
import { discoverAll } from "@veryfront/ai/utils/discovery.ts";
import { exitProcess, isTTY, registerTerminationSignals } from "../utils/index.ts";
import { brand, createTui, dim, handleInput, interceptConsole, success } from "../ui/index.ts";

export interface DevOptions {
  port: number;
  projectDir: string;
  hmr?: boolean;
  /** Use TUI mode (default: true when TTY, false when called programmatically) */
  tui?: boolean;
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
  const { port, projectDir, hmr = true, tui: useTui, demoMode = false } = options;

  // Create resolvable done promise for demo mode
  let doneResolve: (() => void) | null = null;
  const donePromise = new Promise<void>((resolve) => {
    doneResolve = resolve;
  });

  // Determine if we should use TUI
  const shouldUseTui = useTui ?? false; // Default to false for programmatic use

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
  const isProxyMode = config?.fs?.veryfront?.proxyMode === true;

  // Setup TUI or simple logging
  let tui: ReturnType<typeof createTui> | null = null;
  let restoreConsole: (() => void) | null = null;

  if (shouldUseTui && isTTY() && !isProxyMode) {
    tui = createTui({ title: "Veryfront Dev" });
    restoreConsole = interceptConsole(tui);

    tui.setInfo({
      "Local": `http://lvh.me:${finalPort}`,
      "HMR": enableHMR ? "enabled" : "disabled",
    });

    tui.setSteps(["Config", "AI", "Server"]);
    tui.setStatus("Starting...", "loading");
  }

  const log = (msg: string) => {
    if (tui) tui.addLog(msg);
  };

  // Validate AI configuration
  if (config) {
    runAIConfigValidation(config);
  }
  tui?.completeStep();

  // Auto-discover AI components
  try {
    const aiResult = await discoverAll({ baseDir: projectDir, verbose: false });
    const total = aiResult.agents.size + aiResult.tools.size + aiResult.prompts.size +
      aiResult.resources.size;
    if (total > 0) {
      log(
        `AI: ${aiResult.agents.size} agents, ${aiResult.tools.size} tools, ${aiResult.prompts.size} prompts`,
      );
    }
  } catch {
    log("AI discovery skipped");
  }
  tui?.completeStep();

  // Pre-compile MDX if enabled
  if (config?.experimental?.precompileMDX) {
    const outputDir = join(projectDir, ".veryfront", "compiled");
    try {
      await compileAllMDX({ projectDir, outputDir, mode: "development" });
      void watchMDX({ projectDir, outputDir, mode: "development" });
      log("MDX pre-compilation enabled");
    } catch {
      log("MDX pre-compilation failed");
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
        if (tui) {
          tui.setStatus(`Port ${finalPort} is already in use`, "error");
          await new Promise((r) => setTimeout(r, 2000));
          tui.cleanup();
          restoreConsole?.();
        }
        throw new VeryfrontError(
          `Port ${finalPort} is already in use`,
          ErrorCode.INITIALIZATION_ERROR,
          { port: finalPort },
        );
      }
    }
    throw error;
  }

  tui?.completeStep();
  tui?.setStatus("Running - Press Ctrl+C to stop", "success");

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      if (!demoMode) exitProcess(0);
      return;
    }
    shuttingDown = true;

    if (tui) {
      tui.setStatus("Shutting down...", "loading");
    }

    const timeout = demoMode ? null : setTimeout(() => exitProcess(0), 3000);
    try {
      shutdownController.abort();
      await devServer?.stop();
    } catch { /* ignore */ }
    if (timeout) clearTimeout(timeout);

    if (tui) {
      tui.cleanup();
      restoreConsole?.();
    }

    // In demo mode, resolve the done promise instead of exiting
    if (demoMode) {
      doneResolve?.();
    } else {
      exitProcess(0);
    }
  };

  registerTerminationSignals(() => void shutdown());

  // Handle TUI input
  if (tui) {
    // Run input handler in background (don't await)
    handleInput(tui, {
      onExit: () => void shutdown(),
    }).catch(() => {});
  }

  // Simple banner for non-TUI mode
  if (!tui && !isProxyMode) {
    console.log();
    console.log(`  ${success("●")} ${brand(`http://lvh.me:${finalPort}/`)}`);
    console.log();
    console.log(dim(`  ctrl+c to stop`));
    console.log();
  }

  return {
    ready: devServer.ready,
    done: donePromise,
    stop: shutdown,
  };
}
