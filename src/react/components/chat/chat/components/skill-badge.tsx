/**
 * Skill Badge - compact indicator for skill tool calls (load_skill, load_skill_reference, execute_skill_script).
 * @module react/components/chat/components/skill-badge
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckCircleIcon, SparklesIcon, XCircleIcon } from "../../../ui/icons/index.ts";
import type { ChatDynamicToolPart, ChatToolPart } from "#veryfront/agent/react";

/** Props accepted by skill badge. */
export interface SkillBadgeProps {
  tool: ChatToolPart | ChatDynamicToolPart;
  className?: string;
  /**
   * Override the state icon. When provided, it replaces the built-in
   * loading/complete/error glyphs for all states.
   */
  icon?: React.ReactNode;
}

function readOwnDataField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) return undefined;
  return descriptor.value;
}

/** Read the skill ID from the flat legacy input or the provider-facing `load` wrapper. */
function readSkillId(input: unknown): string | undefined {
  const skillId = readOwnDataField(input, "skillId");
  if (typeof skillId === "string") return skillId;
  const nestedSkillId = readOwnDataField(readOwnDataField(input, "load"), "skillId");
  return typeof nestedSkillId === "string" ? nestedSkillId : undefined;
}

/** Render skill badge. */
export function SkillBadge({ tool, className, icon }: SkillBadgeProps): React.JSX.Element {
  const input = tool.input as Record<string, unknown> | undefined;
  const skillId = readSkillId(tool.input);
  const isComplete = tool.state === "output-available";
  const isError = tool.state === "output-error";

  let label: string;
  if (tool.toolName === "load_skill" || tool.toolName === "veryfront__load_skill") {
    label = isComplete
      ? `Skill: ${skillId ?? "unknown"}`
      : `Loading skill${skillId ? `: ${skillId}` : ""}...`;
  } else if (
    tool.toolName === "load_skill_reference" || tool.toolName === "veryfront__load_skill_reference"
  ) {
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
        "border border-[var(--outline-border)] bg-transparent text-[var(--faint)]",
        className,
      )}
    >
      {icon ?? (
        <SparklesIcon
          className={cn("size-3", !isComplete && !isError && "animate-pulse")}
        />
      )}
      <span>{label}</span>
      {icon ? null : (
        <>
          {isComplete && <CheckCircleIcon className="size-3 text-[var(--success)]" />}
          {isError && <XCircleIcon className="size-3 text-[var(--destructive)]" />}
        </>
      )}
    </span>
  );
}
