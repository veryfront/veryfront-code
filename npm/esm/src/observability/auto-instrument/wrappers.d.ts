import type { BatchOptions, InstrumentOptions } from "./types.js";
export declare function instrument<T extends (...args: unknown[]) => Promise<unknown>>(fn: T, spanName: string, options?: InstrumentOptions): T;
export declare function instrumentSync<T extends (...args: unknown[]) => unknown>(fn: T, spanName: string, options?: InstrumentOptions): T;
export declare function instrumentBatch<T>(operationName: string, items: T[], processor: (item: T, index: number) => Promise<void>, options?: BatchOptions): Promise<void>;
//# sourceMappingURL=wrappers.d.ts.map