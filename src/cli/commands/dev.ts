
import { compileAllMDX, watchMDX } from "@veryfront/build/compiler/mdx-compiler/index.ts";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import { LOCALHOST } from "@veryfront/config";
import { bold, cyan, dim, green } from "@veryfront/compat/console";
import { join } from "std/path/mod.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { cliLogger } from "@veryfront/utils";
import { getConfig } from "@veryfront/config";
import { createDevServer } from "@veryfront/server/dev-server.ts";
import { getNetworkInterfaces } from "../../platform/compat/process.ts";
import { runAIConfigValidation } from "../../ai/utils/config-validator.ts";
import { discoverAll } from "../../ai/utils/discovery.ts";
import { exitProcess, registerTerminationSignals } from "../utils/index.ts";

export interface DevOptions {
  port: number;
  projectDir: string;
  hmr?: boolean;
}

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
    cliLogger.debug("Failed to get network interfaces:", error);
  }
  return LOCALHOST.HOSTNAME;
}

export async function devCommand(options: DevOptions) {
  const { port, projectDir, hmr = true } = options;

  const adapter = await getAdapter();

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

  const finalPort = config?.dev?.port || port;
  const enableHMR = config?.dev?.hmr !== false && hmr;

  if (config) {
    runAIConfigValidation(config);
  }

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

  const usePrecompiledMDX = config?.experimental?.precompileMDX === true;
  if (usePrecompiledMDX) {
    const outputDir = join(projectDir, ".veryfront", "compiled");

    try {
      await compileAllMDX({
        projectDir,
        outputDir,
        mode: "development",
      });

      void watchMDX({
        projectDir,
        outputDir,
        mode: "development",
      });
    } catch (error) {
      cliLogger.warn("MDX pre-compilation failed, continuing without it:", error);
    }
  }

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

  let shuttingDown = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      cliLogger.info("Force exiting...");
      exitProcess(0);
      return;
    }
    shuttingDown = true;
    cliLogger.info(`Received ${signal}, shutting down dev server...`);

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

  cliLogger.info(`${green("✓")} Server started successfully!\n`);

  const localIP = await getLocalIP();
  cliLogger.info(`  ${bold("Local:")}    ${cyan(`http:
  cliLogger.info(`  ${bold("Network:")}  ${cyan(`http:
  cliLogger.info(`  ${bold("HMR:")}      ${dim(`ws:

  cliLogger.info(dim("  Press ") + bold("Ctrl+C") + dim(" to stop the server\n"));
}
