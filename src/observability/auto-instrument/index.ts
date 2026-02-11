/**
 * Observability Auto Instrument
 *
 * @module observability/auto-instrument
 */

export type { AutoInstrumentConfig } from "./types.ts";

export { initAutoInstrumentation, isAutoInstrumentEnabled } from "./orchestrator.ts";

export {
  createInstrumentedFetch,
  createInstrumentedFetch as instrumentFetch,
  instrumentHttpHandler,
} from "./http-instrumentation.ts";

export { instrumentErrorHandler, instrumentReactRender } from "./react-instrumentation.ts";

export { instrument, instrumentBatch, instrumentSync } from "./wrappers.ts";
