import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.js";
export declare class MiddlewareChain {
    private middleware;
    constructor(middleware?: AgentMiddleware[]);
    execute(context: AgentContext, finalHandler: () => Promise<AgentResponse>): Promise<AgentResponse>;
    use(middleware: AgentMiddleware): this;
    prepend(middleware: AgentMiddleware): this;
    get length(): number;
    isEmpty(): boolean;
}
export declare function createMiddlewareChain(middleware?: AgentMiddleware[]): MiddlewareChain;
//# sourceMappingURL=chain.d.ts.map