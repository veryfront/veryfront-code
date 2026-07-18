import * as React from "react";
import { CommandItem } from "../ui/command.tsx";
import { PlusIcon, SparklesIcon } from "../ui/icons/index.ts";
import { useAgentPicker } from "./agent-picker-context.tsx";

/** Props shared by `AgentPicker.Create` and `AgentPicker.Manage`. */
export interface AgentPickerActionProps {
  /** Override the leading action glyph. */
  icon?: React.ReactNode;
  /** Override the action label. */
  children?: React.ReactNode;
  className?: string;
}

/** Create-agent action. Renders only when `onCreate` is available on the root. */
export function AgentPickerCreate({
  icon,
  children,
  className,
}: AgentPickerActionProps): React.ReactElement | null {
  const { onCreate } = useAgentPicker();
  if (!onCreate) return null;
  return (
    <CommandItem value="Create Agent" onSelect={onCreate} className={className}>
      {icon ?? <PlusIcon />}
      {children ?? "Create Agent"}
    </CommandItem>
  );
}
AgentPickerCreate.displayName = "AgentPicker.Create";

/** Manage-agents action. Renders only when `onManage` is available on the root. */
export function AgentPickerManage({
  icon,
  children,
  className,
}: AgentPickerActionProps): React.ReactElement | null {
  const { onManage } = useAgentPicker();
  if (!onManage) return null;
  return (
    <CommandItem value="Manage Agents" onSelect={onManage} className={className}>
      {icon ?? <SparklesIcon />}
      {children ?? "Manage Agents"}
    </CommandItem>
  );
}
AgentPickerManage.displayName = "AgentPicker.Manage";
