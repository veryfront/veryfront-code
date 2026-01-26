import * as React from "react";
import type { DynamicToolUIPart, ToolState, ToolUIPart } from "../../agent/react/index.js";
export interface ToolInvocationProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Tool name */
    name: string;
    /** Tool input */
    input?: unknown;
    /** Tool output */
    output?: unknown;
    /** Tool state (v5 format) */
    state?: ToolState;
    /** Error text if tool failed */
    errorText?: string;
    /** Whether this is a dynamic tool (MCP, user-defined) */
    dynamic?: boolean;
    children?: React.ReactNode;
}
export declare const ToolInvocation: React.ForwardRefExoticComponent<ToolInvocationProps & React.RefAttributes<HTMLDivElement>>;
export interface ToolResultProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Tool output data */
    output: unknown;
    /** Custom renderer */
    renderOutput?: (output: unknown) => React.ReactNode;
}
export declare const ToolResult: React.ForwardRefExoticComponent<ToolResultProps & React.RefAttributes<HTMLDivElement>>;
/** Union type for both tool types from v5 parts */
type ToolPart = ToolUIPart | DynamicToolUIPart;
export interface ToolListProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Tool parts to display (v5 format) */
    tools: ToolPart[];
    /** Render each tool */
    renderTool?: (tool: ToolPart) => React.ReactNode;
}
export declare const ToolList: React.ForwardRefExoticComponent<ToolListProps & React.RefAttributes<HTMLDivElement>>;
export {};
//# sourceMappingURL=tool-primitives.d.ts.map