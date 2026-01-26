import * as dntShim from "../../../_dnt.shims.js";
import type { Handler, HandlerContext, RouteRegistryConfig } from "./types.js";
export declare class RouteRegistry {
    private handlers;
    private config;
    constructor(config?: RouteRegistryConfig);
    register(handler: Handler): this;
    registerAll(handlers: Handler[]): this;
    execute(req: dntShim.Request, ctx: HandlerContext): Promise<dntShim.Response | null>;
    getHandlers(): ReadonlyArray<Handler>;
    clear(): this;
    remove(name: string): this;
    has(name: string): boolean;
    getStats(): {
        totalHandlers: number;
        handlersByPriority: Record<string, number>;
        handlerNames: string[];
    };
}
//# sourceMappingURL=registry.d.ts.map