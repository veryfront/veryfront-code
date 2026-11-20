/**
 * Integration Connect card
 * @module react/components/chat/components/integration-connect-card
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { Avatar } from "../../../ui/avatar.tsx";
import { Button } from "../../../ui/button.tsx";
import { CodeBlock } from "../../../ui/code-block.tsx";

/** Props for {@link IntegrationConnectCard}. */
export interface IntegrationConnectCardProps {
  /** Integration id, such as `salesforce` or `google_calendar`. */
  integration: string;
  /** The tool result's message, such as "Authentication required for Salesforce." */
  message?: string;
  /** Project the connection belongs to; fills `--project` in the connect command. */
  projectReference?: string;
  /** The app was connected but its connection expired. */
  reconnect?: boolean;
  /**
   * Start the connection in the host, such as an OAuth popup. Without it the card
   * shows the CLI command that connects the app.
   */
  onConnect?: () => void;
  /** Run the turn again once the app is connected. */
  onRetry?: () => void;
  className?: string;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** "Authentication required for Salesforce." → "Salesforce"; otherwise the id in title case. */
function integrationDisplayName(integration: string, message: string | undefined): string {
  const named = message ? /\bfor (.+?)\.?$/.exec(message.trim())?.[1] : undefined;
  if (named && named.length <= 60) return named;
  return integration
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The command that connects the app from the project's folder. */
export function integrationConnectCommand(
  integration: string,
  projectReference?: string,
): string {
  const project = projectReference ? ` --project ${projectReference}` : "";
  return `npx veryfront integration connect ${integration}${project}`;
}

/**
 * Card for a tool call that stopped because its app isn't connected: names the app,
 * offers Connect (host-provided) or the exact command, and runs the turn again.
 */
export function IntegrationConnectCard({
  integration,
  message,
  projectReference,
  reconnect = false,
  onConnect,
  onRetry,
  className,
  ref,
}: IntegrationConnectCardProps): React.JSX.Element {
  const name = integrationDisplayName(integration, message);
  return (
    <div
      ref={ref}
      className={cn(
        "not-prose w-full space-y-3 rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={name} tone="muted" className="size-8" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-[var(--foreground)]">
              {name}
            </span>
            <span className="block text-xs text-[var(--faint)]">
              {reconnect ? "Connection expired" : "Not connected"}
            </span>
          </span>
        </span>
        {onConnect
          ? (
            <Button size="sm" onClick={onConnect}>
              {reconnect ? "Reconnect" : "Connect"}
            </Button>
          )
          : null}
      </div>
      {onConnect ? null : (
        <CodeBlock
          code={integrationConnectCommand(integration, projectReference)}
          language="bash"
        />
      )}
      {onRetry
        ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )
        : null}
    </div>
  );
}
IntegrationConnectCard.displayName = "IntegrationConnectCard";
