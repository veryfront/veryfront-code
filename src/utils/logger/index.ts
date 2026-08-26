/**
 * Utils Logger
 *
 * @module utils/logger
 */

export {
  createRequestLogger,
  createRunUserLogger,
  getDefaultLevel,
  type LogEntry,
  type LogFormat,
  type Logger,
  LogLevel,
  type LogRecordEmitter,
} from "./logger.ts";
import {
  agentLogger as internalAgentLogger,
  bundlerLogger as internalBundlerLogger,
  cliLogger as internalCliLogger,
  getBaseLogger as getInternalBaseLogger,
  type Logger,
  logger as internalLogger,
  proxyLogger as internalProxyLogger,
  rendererLogger as internalRendererLogger,
  serverLogger as internalServerLogger,
} from "./logger.ts";

function immutableLoggerFacade(source: Logger): Logger {
  return Object.freeze({
    debug: (message: string, ...args: unknown[]) => source.debug(message, ...args),
    info: (message: string, ...args: unknown[]) => source.info(message, ...args),
    warn: (message: string, ...args: unknown[]) => source.warn(message, ...args),
    error: (message: string, ...args: unknown[]) => source.error(message, ...args),
    time: <T>(label: string, fn: () => Promise<T>) => source.time(label, fn),
    child: (context: Record<string, unknown>) => immutableLoggerFacade(source.child(context)),
    component: (name: string) => immutableLoggerFacade(source.component(name)),
  });
}

/** Get an immutable base logger without request context awareness. */
export function getBaseLogger(
  prefix: string,
  options?: { injectTraceContext?: boolean },
): Logger {
  return immutableLoggerFacade(getInternalBaseLogger(prefix, options));
}

export const agentLogger = immutableLoggerFacade(internalAgentLogger);
export const bundlerLogger = immutableLoggerFacade(internalBundlerLogger);
export const cliLogger = immutableLoggerFacade(internalCliLogger);
export const logger = immutableLoggerFacade(internalLogger);
export const proxyLogger = immutableLoggerFacade(internalProxyLogger);
export const rendererLogger = immutableLoggerFacade(internalRendererLogger);
export const serverLogger = immutableLoggerFacade(internalServerLogger);
export {
  ANSI,
  colorize,
  formatContextText,
  formatErrorText,
  formatTimestamp,
  formatValue,
  isRecord,
  LEVEL_COLORS,
  LEVEL_GLYPHS,
  type LogLevelName,
  normalizeText,
  padTag,
  PREFIX_WIDTH,
  type SerializedError,
  serializeError,
  TAG_WIDTH,
  truncateText,
} from "./core.ts";
export {
  getRequestContext,
  getRequestLogger,
  type RequestContext,
  runWithRequestContext,
  runWithRequestContextAsync,
} from "./request-context.ts";
export { type LogComponent, LogComponents } from "./components.ts";
