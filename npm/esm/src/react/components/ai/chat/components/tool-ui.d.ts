/**
 * Tool UI Components
 * @module ai/react/components/chat/components/tool-ui
 */
import * as React from "react";
import type { DynamicToolUIPart, ToolUIPart } from "../../../../../agent/react/index.js";
/** Tool call status badge component (AI Elements style) */
export declare function ToolStatusBadge({ state }: {
    state: string;
}): React.JSX.Element;
/**
 * Tool call card component - renders tool invocations with parameters and results
 * Styled to match AI Elements (https://ai-sdk.dev/elements)
 */
export declare function ToolCallCard({ tool, }: {
    tool: ToolUIPart | DynamicToolUIPart;
}): React.JSX.Element;
//# sourceMappingURL=tool-ui.d.ts.map