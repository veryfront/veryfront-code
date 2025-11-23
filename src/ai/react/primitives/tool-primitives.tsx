/**
 * Tool Primitives - Layer 2 (Unstyled)
 *
 * Primitives for displaying tool invocations and results.
 * Built on Radix UI patterns (shadcn-compatible).
 */

import * as React from "react";
import type { ToolCall } from "../../types/agent.ts";

export interface ToolInvocationProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tool name */
  name: string;

  /** Tool arguments */
  args?: Record<string, unknown>;

  /** Tool status */
  status?: ToolCall["status"];

  children?: React.ReactNode;
}

/**
 * ToolInvocation - Tool call display
 *
 * @example
 * ```tsx
 * <ToolInvocation
 *   name={tool.name}
 *   args={tool.args}
 *   status={tool.status}
 *   className="border-l-4 border-blue-500 pl-4"
 * >
 *   <ToolResult result={tool.result} />
 * </ToolInvocation>
 * ```
 */
export const ToolInvocation = React.forwardRef<
  HTMLDivElement,
  ToolInvocationProps
>(({ className, name, args, status, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={className}
      data-tool-invocation=""
      data-tool-name={name}
      data-status={status}
      {...props}
    >
      <div data-tool-header="">
        <span data-tool-name="">{name}</span>
        {status && <span data-tool-status="">({status})</span>}
      </div>

      {args && (
        <div data-tool-args="">
          <pre>{JSON.stringify(args, null, 2)}</pre>
        </div>
      )}

      {children}
    </div>
  );
});

ToolInvocation.displayName = "ToolInvocation";

export interface ToolResultProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tool result data */
  result: unknown;

  /** Custom renderer */
  renderResult?: (result: unknown) => React.ReactNode;
}

/**
 * ToolResult - Tool result display
 *
 * @example
 * ```tsx
 * <ToolResult
 *   result={tool.result}
 *   className="mt-2 p-2 bg-gray-100 rounded"
 * />
 * ```
 */
export const ToolResult = React.forwardRef<HTMLDivElement, ToolResultProps>(
  ({ className, result, renderResult, ...props }, ref) => {
    const content = renderResult ? renderResult(result) : JSON.stringify(result, null, 2);

    return (
      <div
        ref={ref}
        className={className}
        data-tool-result=""
        {...props}
      >
        {typeof content === "string" ? <pre>{content}</pre> : content}
      </div>
    );
  },
);

ToolResult.displayName = "ToolResult";

export interface ToolListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tool calls to display */
  toolCalls: ToolCall[];

  /** Render each tool */
  renderTool?: (toolCall: ToolCall) => React.ReactNode;
}

/**
 * ToolList - Display list of tool calls
 *
 * @example
 * ```tsx
 * <ToolList
 *   toolCalls={agent.toolCalls}
 *   className="space-y-2"
 *   renderTool={(tool) => (
 *     <ToolInvocation {...tool}>
 *       <ToolResult result={tool.result} />
 *     </ToolInvocation>
 *   )}
 * />
 * ```
 */
export const ToolList = React.forwardRef<HTMLDivElement, ToolListProps>(
  ({ className, toolCalls, renderTool, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={className}
        data-tool-list=""
        {...props}
      >
        {toolCalls.map((tool) =>
          renderTool
            ? <React.Fragment key={tool.id}>{renderTool(tool)}</React.Fragment>
            : (
              <ToolInvocation
                key={tool.id}
                name={tool.name}
                args={tool.args}
                status={tool.status}
              >
                {tool.result !== undefined && <ToolResult result={tool.result} />}
              </ToolInvocation>
            )
        )}
      </div>
    );
  },
);

ToolList.displayName = "ToolList";
