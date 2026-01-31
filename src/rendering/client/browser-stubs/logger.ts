function noop(): void {}

const logger = {
  debug: noop,
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

export const rendererLogger = logger;
export const serverLogger = logger;
