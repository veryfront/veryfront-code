/**
 * Utils Logger
 *
 * @module utils/logger
 */

export {
  __registerRequestContextGetter,
  __registerTraceContextGetter,
  __resetLoggerConfigForTests,
  __resetTraceContextGetterForTests,
  agentLogger,
  bundlerLogger,
  cliLogger,
  createRequestLogger,
  getBaseLogger,
  getDefaultLevel,
  type LogEntry,
  type LogFormat,
  type Logger,
  logger,
  LogLevel,
  proxyLogger,
  rendererLogger,
  serverLogger,
} from "./logger.ts";
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
  requestContextStore,
  runWithRequestContext,
  runWithRequestContextAsync,
} from "./request-context.ts";
export { type LogComponent, LogComponents } from "./components.ts";
