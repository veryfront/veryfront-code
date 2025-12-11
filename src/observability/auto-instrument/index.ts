export type { AutoInstrumentConfig } from "./types.ts";

export {
  __resetAutoInstrumentForTests,
  initAutoInstrumentation,
  isAutoInstrumentEnabled,
} from "./orchestrator.ts";

export { createInstrumentedFetch, instrumentHttpHandler } from "./http-instrumentation.ts";

export { createInstrumentedFetch as instrumentFetch } from "./http-instrumentation.ts";

export { instrumentErrorHandler, instrumentReactRender } from "./react-instrumentation.ts";

export { instrument, instrumentBatch, instrumentSync } from "./wrappers.ts";
