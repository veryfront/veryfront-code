import * as React from "react";
import type { AgentStatus, Message, ToolCall } from "../../../agent/index.js";
import { type AgentTheme } from "./theme.js";
export interface AgentCardProps {
    /** Agent messages */
    messages?: Message[];
    /** Tool calls */
    toolCalls?: ToolCall[];
    /** Agent status */
    status: AgentStatus;
    /** Thinking/reasoning text */
    thinking?: string;
    /** Additional class name */
    className?: string;
    /** Theme customization */
    theme?: Partial<AgentTheme>;
    /** Custom tool renderer */
    renderTool?: (toolCall: ToolCall) => React.ReactNode;
}
export declare const AgentCard: React.ForwardRefExoticComponent<AgentCardProps & React.RefAttributes<HTMLDivElement>>;
//# sourceMappingURL=agent-card.d.ts.map