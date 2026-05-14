import {
  type AbortRejectionGuardLogger,
  type AbortRejectionProcessTarget,
  installAbortRejectionGuard,
} from "../abort-rejection-guard.ts";

export type AgentServiceTraceContext = {
  traceId?: string;
  spanId?: string;
};

export type AgentServiceTraceContextGetter = () => AgentServiceTraceContext;

export type AgentServiceBootstrapExit = (code: number) => never | void;

export type BootstrapAgentServiceOptions = {
  loadLogger?: () => AbortRejectionGuardLogger | Promise<AbortRejectionGuardLogger>;
  initializeTelemetry?: () => boolean | Promise<boolean>;
  onTelemetryInitialized?: () => void | Promise<void>;
  getTraceContext?: AgentServiceTraceContextGetter;
  registerTraceContextGetter?: (getter: AgentServiceTraceContextGetter) => void | Promise<void>;
  start: () => void | Promise<void>;
};

export type RunAgentServiceMainOptions = BootstrapAgentServiceOptions & {
  onStartupError?: (error: unknown) => void | Promise<void>;
  exit?: AgentServiceBootstrapExit;
  processTarget?: AbortRejectionProcessTarget | null;
};

async function initializeTelemetry(
  options: Pick<BootstrapAgentServiceOptions, "initializeTelemetry" | "onTelemetryInitialized">,
): Promise<void> {
  const enabled = await options.initializeTelemetry?.();
  if (enabled) {
    await options.onTelemetryInitialized?.();
  }
}

async function registerTraceContext(
  options: Pick<BootstrapAgentServiceOptions, "getTraceContext" | "registerTraceContextGetter">,
): Promise<void> {
  if (!options.getTraceContext || !options.registerTraceContextGetter) {
    return;
  }

  await options.registerTraceContextGetter(options.getTraceContext);
}

export async function bootstrapAgentService(
  options: BootstrapAgentServiceOptions,
): Promise<void> {
  installAbortRejectionGuard({
    loadLogger: options.loadLogger,
  });

  await initializeTelemetry(options);
  await registerTraceContext(options);
  await options.start();
}

export function runAgentServiceMain(options: RunAgentServiceMainOptions): Promise<void> {
  installAbortRejectionGuard({
    loadLogger: options.loadLogger,
    processTarget: options.processTarget,
  });

  return initializeTelemetry(options)
    .then(() => registerTraceContext(options))
    .then(() => options.start())
    .catch(async (error: unknown) => {
      await options.onStartupError?.(error);
      if (options.exit) {
        options.exit(1);
        return;
      }
      throw error;
    });
}
