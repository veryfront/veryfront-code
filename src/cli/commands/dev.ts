/**
 * Dev Command - Development server with HMR and Client-Side Features
 */

import { compileAllMDX, watchMDX } from "@veryfront/build/compiler/mdx-compiler/index.ts";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import { LOCALHOST } from "@veryfront/config";
import { bold, cyan, dim, green } from "@veryfront/compat/console";
import { join } from "@veryfront/platform/compat/path/index.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { cliLogger } from "@veryfront/utils";
import { getConfig } from "@veryfront/config";
import { createDevServer } from "@veryfront/server/dev-server.ts";
import { getNetworkInterfaces } from "@veryfront/platform/compat/process.ts";
import { runAIConfigValidation } from "@veryfront/ai/utils/config-validator.ts";
import { discoverAll } from "@veryfront/ai/utils/discovery.ts";
import { exitProcess, registerTerminationSignals } from "../utils/index.ts";

export interface DevOptions {
  port: number;
  projectDir: string;
  hmr?: boolean;
}

// Alias for backward compatibility
export type DevCommandOptions = DevOptions;

async function getLocalIP(): Promise<string> {
  try {
    const interfaces = await getNetworkInterfaces();
    for (const iface of interfaces) {
      if (iface.family === "IPv4" && !iface.address.startsWith("127.")) {
        return iface.address;
      }
    }
  } catch (error) {
    // Network interface enumeration may fail due to permissions
    cliLogger.debug("Failed to get network interfaces:", error);
  }
  return LOCALHOST.HOSTNAME;
}

export async function devCommand(options: DevOptions) {
  const { port, projectDir, hmr = true } = options;

  // Get adapter first
  const adapter = await getAdapter();

  // Load config with better error handling
  let config;
  try {
    config = await getConfig(projectDir, adapter);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      throw new VeryfrontError(
        "No veryfront.config.js found in project directory",
        ErrorCode.CONFIG_ERROR,
        { projectDir },
      );
    }
    throw error;
  }

  // CLI port takes precedence over config port
  // Only use config port if CLI didn't specify one (port equals default)
  const DEFAULT_DEV_PORT = 3000;
  const finalPort = port !== DEFAULT_DEV_PORT ? port : (config?.dev?.port || port);
  const enableHMR = config?.dev?.hmr !== false && hmr;

  // Validate AI configuration
  if (config) {
    runAIConfigValidation(config);
  }

  // Auto-discover AI components (agents, tools, prompts, resources)
  try {
    const aiResult = await discoverAll({
      baseDir: projectDir,
      verbose: false,
    });

    const totalDiscovered = aiResult.agents.size +
      aiResult.tools.size +
      aiResult.prompts.size +
      aiResult.resources.size;

    if (totalDiscovered > 0) {
      cliLogger.info(
        `${green("✓")} AI Discovery: ${aiResult.agents.size} agents, ` +
          `${aiResult.tools.size} tools, ${aiResult.prompts.size} prompts, ` +
          `${aiResult.resources.size} resources`,
      );
    }

    if (aiResult.errors.length > 0) {
      for (const err of aiResult.errors) {
        cliLogger.warn(`AI discovery error in ${err.file}: ${err.error.message}`);
      }
    }
  } catch (error) {
    cliLogger.debug("AI discovery skipped (no ai/ directory or error):", error);
  }

  // Pre-compile MDX files if enabled
  const usePrecompiledMDX = config?.experimental?.precompileMDX === true;
  if (usePrecompiledMDX) {
    const outputDir = join(projectDir, ".veryfront", "compiled");

    try {
      // Compile all MDX files
      await compileAllMDX({
        projectDir,
        outputDir,
        mode: "development",
      });

      // Start watching for changes
      void watchMDX({
        projectDir,
        outputDir,
        mode: "development",
      });
    } catch (error) {
      // MDX compilation is non-critical, log but continue
      cliLogger.warn("MDX pre-compilation failed, continuing without it:", error);
    }
  }

  // Start dev server with new features
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
      // Check for common errors
      const message = error.message.toLowerCase();
      if (message.includes("eaddrinuse") || message.includes("address already in use")) {
        throw new VeryfrontError(
          `Port ${finalPort} is already in use`,
          ErrorCode.INITIALIZATION_ERROR,
          {
            port: finalPort,
          },
        );
      }
    }
    throw error;
  }

  // Graceful shutdown on termination signals
  let shuttingDown = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      // Second signal - force exit immediately
      cliLogger.info("Force exiting...");
      exitProcess(0);
      return;
    }
    shuttingDown = true;
    cliLogger.info(`Received ${signal}, shutting down dev server...`);

    // Force exit after 3 seconds if graceful shutdown hangs
    const forceExitTimeout = setTimeout(() => {
      cliLogger.warn("Graceful shutdown timed out, forcing exit...");
      exitProcess(0);
    }, 3000);

    try {
      shutdownController.abort();
      await devServer?.stop();
    } catch (error) {
      cliLogger.warn("Error while shutting down dev server:", error);
    } finally {
      clearTimeout(forceExitTimeout);
      exitProcess(0);
    }
  };

  registerTerminationSignals((signal) => {
    void shutdown(signal);
  });

  // Enhanced startup message
  cliLogger.info(`${green("✓")} Server started successfully!\n`);

  const localIP = await getLocalIP();
  cliLogger.info(`  ${bold("Local:")}    ${cyan(`http://${LOCALHOST.HOSTNAME}:${finalPort}`)}`);
  cliLogger.info(`  ${bold("Network:")}  ${cyan(`http://${localIP}:${finalPort}`)}`);
  cliLogger.info(`  ${bold("HMR:")}      ${dim(`ws://${LOCALHOST.HOSTNAME}:${finalPort}/_ws`)}\n`);

  cliLogger.info(dim("  Press ") + bold("Ctrl+C") + dim(" to stop the server\n"));
}
