/**
 * Side-effect module: activates the ext-babel factory and registers the
 * `CodeParser` contract with the core registry. Tests that exercise
 * `injectNodePositions()` or the generic parse/traverse/generate API
 * import this first so the contract resolver finds an implementation.
 */

import { register as registerContract } from "#veryfront/extensions/contracts.ts";
import extBabelFactory from "../../../../extensions/ext-babel/src/index.ts";

const ext = extBabelFactory();
const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
const ctx = {
  config: {},
  logger: noopLogger,
  provide: (name: string, impl: unknown) => registerContract(name, impl),
  get: () => undefined,
  resolve: () => {
    throw new Error("resolve not used in setup");
  },
};
await ext.setup?.(ctx as never);
