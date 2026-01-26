import * as dntShim from "../../../_dnt.shims.js";
import { z } from "zod";
import { type ParseFormOptions, type ParseJsonOptions } from "./types.js";
export declare function parseJsonBody<T>(request: dntShim.Request, schema: z.ZodSchema<T>, options?: ParseJsonOptions): Promise<T>;
export declare function parseFormData<T>(request: dntShim.Request, schema: z.ZodSchema<T>, options?: ParseFormOptions): Promise<T>;
export declare function parseQueryParams<T>(request: dntShim.Request, schema: z.ZodSchema<T>): T;
//# sourceMappingURL=parsers.d.ts.map