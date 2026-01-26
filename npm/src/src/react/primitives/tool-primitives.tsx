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

export const ToolInvocation = React.forwardRef<HTMLDivElement, ToolInvocationProps>(
  ({ className, name, input, state, errorText, dynamic, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={className}
        data-tool-invocation=""
        data-tool-name={name}
        data-state={state}
        data-dynamic={dynamic || undefined}
        {...props}
      >
        <div data-tool-header="">
          <span data-tool-name="">{name}</span>
          {state && <span data-tool-state="">({state})</span>}
          {dynamic && <span data-tool-dynamic="">[dynamic]</span>}
        </div>

        {input !== undefined && (
          <div data-tool-input="">
            <pre>{JSON.stringify(input, null, 2)}</pre>
          </div>
        )}

        {errorText && <div data-tool-error="">{errorText}</div>}

        {children}
      </div>
    );
  },
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
    const content = renderOutput ? renderOutput(output) : JSON.stringify(output, null, 2);

    return (
      <div ref={ref} className={className} data-tool-result="" {...props}>
        {typeof content === "string" ? <pre>{content}</pre> : content}
      </div>
    );
  },
);

ToolResult.displayName = "ToolResult";

/** Union type for both tool types from v5 parts */
type ToolPart = ToolUIPart | DynamicToolUIPart;

export interface ToolListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tool parts to display (v5 format) */
  tools: ToolPart[];

  /** Render each tool */
  renderTool?: (tool: ToolPart) => React.ReactNode;
}

/**
 * Check if a part is a dynamic tool
 */
function isDynamicTool(tool: ToolPart): tool is DynamicToolUIPart {
  return tool.type === "dynamic-tool";
}

export const ToolList = React.forwardRef<HTMLDivElement, ToolListProps>(
  ({ className, tools, renderTool, ...props }, ref) => {
    return (
      <div ref={ref} className={className} data-tool-list="" {...props}>
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
    );
  },
);

ToolList.displayName = "ToolList";
