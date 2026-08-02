import * as React from "react";
import type { ChatDynamicToolPart, ChatToolPart, ChatToolState } from "#veryfront/agent/react";
import { toChatJsonValue } from "#veryfront/chat/json-value.ts";

const TOOL_VALUE_LIMITS = Object.freeze({
  maxContainerEntries: 500,
  maxDepth: 12,
  maxNodes: 2_000,
  maxStringChars: 64 * 1024,
});

function formatToolValue(value: unknown): string {
  return JSON.stringify(toChatJsonValue(value, TOOL_VALUE_LIMITS), null, 2);
}

export interface ToolInvocationProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tool name */
  name: string;

  /** Tool input */
  input?: unknown;

  /** Tool output */
  output?: unknown;

  /** Tool state (v5 format) */
  state?: ChatToolState;

  /** Error text if tool failed */
  errorText?: string;

  /** Whether this is a dynamic tool (MCP, user-defined) */
  dynamic?: boolean;

  children?: React.ReactNode;
}

export const ToolInvocation = React.forwardRef<HTMLDivElement, ToolInvocationProps>(
  (
    { className, name, input, output: _output, state, errorText, dynamic, children, ...props },
    ref,
  ) => (
    <div
      {...props}
      ref={ref}
      className={className}
      data-tool-invocation=""
      data-tool-name={name}
      data-state={state}
      data-dynamic={dynamic || undefined}
    >
      <div data-tool-header="">
        <span data-tool-name="">{name}</span>
        {state && <span data-tool-state="">({state})</span>}
        {dynamic && <span data-tool-dynamic="">[dynamic]</span>}
      </div>

      {input !== undefined && (
        <div data-tool-input="">
          <pre>{formatToolValue(input)}</pre>
        </div>
      )}

      {errorText && <div data-tool-error="">{errorText}</div>}

      {children}
    </div>
  ),
);

ToolInvocation.displayName = "ToolInvocation";

export interface ToolResultProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tool output data */
  output: unknown;

  /** Custom renderer */
  renderOutput?: (output: unknown) => React.ReactNode;
}

export const ToolResult = React.forwardRef<HTMLDivElement, ToolResultProps>(
  ({ className, output, renderOutput, ...props }, ref) => {
    const content = renderOutput ? renderOutput(output) : formatToolValue(output);

    return (
      <div {...props} ref={ref} className={className} data-tool-result="">
        {typeof content === "string" ? <pre>{content}</pre> : content}
      </div>
    );
  },
);

ToolResult.displayName = "ToolResult";

/** Union type for both tool types from v5 parts */
type ToolPart = ChatToolPart | ChatDynamicToolPart;

export interface ToolListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tool parts to display (v5 format) */
  tools: ToolPart[];

  /** Render each tool */
  renderTool?: (tool: ToolPart) => React.ReactNode;
}

function isDynamicTool(tool: ToolPart): tool is ChatDynamicToolPart {
  return tool.type === "dynamic-tool";
}

export const ToolList = React.forwardRef<HTMLDivElement, ToolListProps>(
  ({ className, tools, renderTool, ...props }, ref) => (
    <div {...props} ref={ref} className={className} data-tool-list="">
      {tools.map((tool) => {
        if (renderTool) {
          return <React.Fragment key={tool.toolCallId}>{renderTool(tool)}</React.Fragment>;
        }

        return (
          <ToolInvocation
            key={tool.toolCallId}
            name={tool.toolName}
            input={tool.input}
            state={tool.state}
            errorText={tool.errorText}
            dynamic={isDynamicTool(tool)}
          >
            {tool.output !== undefined && <ToolResult output={tool.output} />}
          </ToolInvocation>
        );
      })}
    </div>
  ),
);

ToolList.displayName = "ToolList";
