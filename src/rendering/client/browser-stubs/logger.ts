
const noop = () => {};

export const rendererLogger = {
  debug: noop,
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

export const serverLogger = rendererLogger;
