import * as dntShim from "../../../_dnt.shims.js";
import type { Middleware } from "./types.js";
export type LogFormat = "combined" | "common" | "dev" | "short" | "tiny" | "json";
export interface LoggerOptions {
    format?: LogFormat;
    skip?: (req: dntShim.Request) => boolean;
    log?: (message: string) => void;
}
export declare function logger(options?: LoggerOptions): Middleware;
export declare function devLogger(): Middleware;
export declare function prodLogger(): Middleware;
//# sourceMappingURL=logger.d.ts.map