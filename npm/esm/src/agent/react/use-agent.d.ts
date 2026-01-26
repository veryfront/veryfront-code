import type { AgentStatus, Message, ToolCall } from "../types.js";
export interface UseAgentOptions {
    /** Agent ID or endpoint */
    agent: string;
    /** Callback when tool is called */
    onToolCall?: (toolCall: ToolCall) => void;
    /** Callback when tool result received */
    onToolResult?: (toolCall: ToolCall, result: unknown) => void;
    /** Callback when error occurs */
    onError?: (error: Error) => void;
}
export interface UseAgentResult {
    /** Message history */
    messages: Message[];
    /** Active tool calls */
    toolCalls: ToolCall[];
    /** Agent status */
    status: AgentStatus;
    /** Thinking/reasoning text */
    thinking?: string;
    /** Invoke the agent */
    invoke: (input: string) => Promise<void>;
    /** Stop agent execution */
    stop: () => void;
    /** Loading state */
    isLoading: boolean;
    /** Error state */
    error: Error | null;
}
export declare function useAgent(options: UseAgentOptions): UseAgentResult;
//# sourceMappingURL=use-agent.d.ts.map