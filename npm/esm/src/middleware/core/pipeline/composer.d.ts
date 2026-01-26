import type { MiddlewareHandler } from "../types.js";
export declare function composeMiddleware(globalMiddlewares: MiddlewareHandler[], registry: Array<{
    pattern: RegExp;
    use: MiddlewareHandler[];
}>): MiddlewareHandler;
//# sourceMappingURL=composer.d.ts.map