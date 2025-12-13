
import * as React from "react";
import type { ToolCall } from "../../types/agent.ts";

export interface ToolInvocationProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;

  args?: Record<string, unknown>;

  status?: ToolCall["status"];

  children?: React.ReactNode;
}

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
  result: unknown;

  renderResult?: (result: unknown) => React.ReactNode;
}

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
  toolCalls: ToolCall[];

  renderTool?: (toolCall: ToolCall) => React.ReactNode;
}

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
