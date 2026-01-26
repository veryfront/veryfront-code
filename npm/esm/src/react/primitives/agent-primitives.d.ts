import * as React from "react";
import type { AgentStatus as AgentStatusType } from "../../agent/index.js";
export interface AgentContainerProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}
export declare const AgentContainer: React.ForwardRefExoticComponent<AgentContainerProps & React.RefAttributes<HTMLDivElement>>;
export interface AgentStatusProps extends React.HTMLAttributes<HTMLDivElement> {
    status: AgentStatusType;
    label?: string;
}
export declare const AgentStatus: React.ForwardRefExoticComponent<AgentStatusProps & React.RefAttributes<HTMLDivElement>>;
export interface ThinkingIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
}
export declare const ThinkingIndicator: React.ForwardRefExoticComponent<ThinkingIndicatorProps & React.RefAttributes<HTMLDivElement>>;
//# sourceMappingURL=agent-primitives.d.ts.map