import * as dntShim from "../../../_dnt.shims.js";
export declare function instrumentHttpHandler(handler: (request: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response): (request: dntShim.Request) => Promise<dntShim.Response>;
/**
 * Create an instrumented fetch function without mutating globals
 * Returns a wrapped fetch that adds OpenTelemetry spans
 *
 * @param baseFetch - The fetch function to instrument (defaults to globalThis.fetch)
 * @returns Instrumented fetch function
 *
 * @example
 * ```ts
 * const instrumentedFetch = createInstrumentedFetch()
 * const response = await instrumentedFetch('https://api.example.com')
 * ```
 */
export declare function createInstrumentedFetch(baseFetch?: typeof dntShim.fetch): typeof dntShim.fetch;
//# sourceMappingURL=http-instrumentation.d.ts.map