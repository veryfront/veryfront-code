import { serverLogger as logger } from "@veryfront/utils";
import { LOCALHOST } from "@veryfront/config";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { createVeryfrontHandler } from "./universal-handler/index.ts";
import { bootstrapProd } from "./bootstrap.ts";

interface ServerOptions {
  projectDir: string;
  port: number;
  hostname?: string;
  signal?: AbortSignal;
}

export interface ServerHandle {
  ready: Promise<void>;
  stop: () => Promise<void>;
}

export async function startUniversalServer(
  options: ServerOptions & {
    debug?: boolean;
    adapter?: RuntimeAdapter;
    mode?: "development" | "production";
  },
): Promise<ServerHandle> {
  const { projectDir, port, hostname = "0.0.0.0", signal, debug, mode = "production" } = options;
  const baseAdapter = options.adapter ?? (await getAdapter());

  // Bootstrap framework to initialize FSAdapter if configured
  const bootstrap = await bootstrapProd(projectDir, baseAdapter);
  const adapter = bootstrap.adapter;

  if (bootstrap.usingFSAdapter) {
    logger.info("FSAdapter initialized", { type: bootstrap.fsAdapterType });
  }

  logger.info("Starting universal production server", { projectDir, port, hostname });

  const handler = createVeryfrontHandler(projectDir, adapter, {
    projectDir,
    debug,
    mode,
  });

  let onListenResolve: (() => void) | null = null;
  const listenReady = new Promise<void>((resolve) => (onListenResolve = resolve));

  const ready = Promise.all([
    listenReady,
    handler.ready ?? Promise.resolve(),
  ]).then(() => undefined);

  const server = await adapter.serve(handler, {
    port,
    hostname,
    signal,
    onListen: (params) => {
      try {
        onListenResolve?.();
        logger.info("Universal server listening", params);
      } catch {
        /* ignore */
      }
    },
  });

  const stop = async () => {
    try {
      await server.stop();
    } catch {
      /* ignore */
    }
  };

  return { ready, stop };
}

export async function startProductionServer(options: ServerOptions): Promise<ServerHandle> {
  return await startUniversalServer({ ...options });
}

if (import.meta.main) {
  try {
    const { cwd } = await import("../runtime/compat/process.ts");
    const adapter = await getAdapter();

    const shutdownController = new AbortController();
    const projectDir = cwd();
    const port = Number(
      adapter.env.get("PORT") ?? adapter.env.get("VERYFRONT_PORT") ?? 3000,
    );
    const hostname = adapter.env.get("HOST") ?? adapter.env.get("HOSTNAME") ?? LOCALHOST.IPV4;

    const server = await startUniversalServer({
      projectDir,
      port,
      hostname,
      debug: adapter.env.get("VERYFRONT_DEBUG") === "1",
      adapter, // Pass adapter to avoid re-detection
      signal: shutdownController.signal,
    });

    // Graceful shutdown for direct CLI execution (e.g., deno run)
    let shuttingDown = false;
    const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`Received ${signal}, shutting down production server...`);
      try {
        shutdownController.abort();
        await server.stop();
      } catch (error) {
        logger.warn("Error while shutting down production server:", error);
      }
    };

    const signals: Array<"SIGINT" | "SIGTERM"> = ["SIGINT", "SIGTERM"];
    for (const signal of signals) {
      if (typeof Deno !== "undefined" && "addSignalListener" in Deno) {
        Deno.addSignalListener(signal, () => {
          void shutdown(signal);
        });
      } else if (typeof process !== "undefined" && typeof process.on === "function") {
        process.on(signal, () => {
          void shutdown(signal);
        });
      }
    }
  } catch (e) {
    logger.error("Failed to start production server:", e);
  }
}
