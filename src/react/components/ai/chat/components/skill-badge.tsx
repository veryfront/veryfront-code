/**
 * Skill Badge — compact indicator for skill tool calls (load-skill, load-skill-reference, execute-skill-script).
 * @module ai/react/components/chat/components/skill-badge
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckCircleIcon, SparklesIcon, XCircleIcon } from "../../icons/index.ts";
import type { DynamicToolUIPart, ToolUIPart } from "#veryfront/agent/react";

export interface SkillBadgeProps {
  tool: ToolUIPart | DynamicToolUIPart;
  className?: string;
}

export function SkillBadge({ tool, className }: SkillBadgeProps): React.JSX.Element {
  const input = tool.input as Record<string, unknown> | undefined;
  const skillId = input?.skillId as string | undefined;
  const isComplete = tool.state === "output-available";
  const isError = tool.state === "output-error";

  let label: string;
  if (tool.toolName === "load-skill") {
    label = isComplete
      ? `Skill: ${skillId ?? "unknown"}`
      : `Loading skill${skillId ? `: ${skillId}` : ""}...`;
  } else if (tool.toolName === "load-skill-reference") {
    const ref = input?.reference as string | undefined;
    label = isComplete ? `Reference: ${ref ?? "unknown"}` : `Reading${ref ? `: ${ref}` : ""}...`;
  } else {
    const script = input?.script as string | undefined;
    label = isComplete
      ? `Script: ${script ?? "complete"}`
      : `Running${script ? `: ${script}` : ""}...`;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        "bg-[var(--accent)] text-[var(--muted-foreground)] border border-[var(--border)]",
        className,
      )}
    >
      <SparklesIcon className={cn("size-3", !isComplete && !isError && "animate-pulse")} />
      <span>{label}</span>
      {isComplete && <CheckCircleIcon className="size-3 text-[var(--success)]" />}
      {isError && <XCircleIcon className="size-3 text-[var(--destructive)]" />}
    </span>
  );
}
