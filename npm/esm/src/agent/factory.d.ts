import * as dntShim from "../../_dnt.shims.js";
import type { Agent, AgentConfig } from "./types.js";
export interface AgentStreamResult {
    toDataStreamResponse(options?: {
        headers?: Record<string, string>;
        status?: number;
        statusText?: string;
    }): dntShim.Response;
}
export declare function agent(config: AgentConfig): Agent;
//# sourceMappingURL=factory.d.ts.map