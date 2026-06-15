function noop(): void {}

const logger = {
  debug: noop,
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  component: () => logger,
};

export const rendererLogger = logger;
export const serverLogger = logger;
export const PREFETCH_MAX_SIZE_BYTES = 200 * 1024;
export const PREFETCH_DEFAULT_TIMEOUT_MS = 10000;
export const PREFETCH_DEFAULT_DELAY_MS = 200;
