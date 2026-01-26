import * as dntShim from "../../../_dnt.shims.js";
import { z } from "zod";
import { type RequestLimits, type ValidatedData } from "./types.js";
export interface ValidatedHandlerConfig<TBody = unknown, TQuery = unknown> {
    body?: z.ZodSchema<TBody>;
    query?: z.ZodSchema<TQuery>;
    limits?: RequestLimits;
}
export type ValidatedHandlerFunction<TBody = unknown, TQuery = unknown> = (request: dntShim.Request, validated: ValidatedData<TBody, TQuery>) => Promise<dntShim.Response> | dntShim.Response;
/** Create a validated API handler wrapper that auto-validates body/query with Zod schemas */
export declare function createValidatedHandler<TBody = unknown, TQuery = unknown>(config: ValidatedHandlerConfig<TBody, TQuery>, handler: ValidatedHandlerFunction<TBody, TQuery>): (request: dntShim.Request) => Promise<dntShim.Response>;
//# sourceMappingURL=handler.d.ts.map