/**
 * ChatAgentPicker — the connected {@link AgentPicker}. Fetches the project's
 * agents with {@link useAgents} and renders the picker only when there is more
 * than one to switch between, so it can be dropped straight into the composer's
 * `toolbarStart` slot without the caller wiring up data:
 *
 * ```tsx
 * const [agentId, setAgentId] = React.useState<string>();
 * <ChatInput
 *   …
 *   toolbarStart={<ChatAgentPicker value={agentId} onValueChange={setAgentId} />}
 * />
 * ```
 *
 * It renders nothing while loading, on error, or when the project exposes fewer
 * than `minAgents` (default 2) agents — a single-agent project has nothing to
 * switch to, so the slot stays empty. Selection is controlled by the caller
 * (`value` / `onValueChange`), matching {@link AgentPicker}.
 *
 * @module react/components/chat/chat-agent-picker
 */
import * as React from "react";
import { type AgentMetadata, useAgents } from "#veryfront/agent/react";
import { type AgentOption, AgentPicker } from "./agent-picker.tsx";

/**
 * Narrow browser-safe agent metadata to the picker's row shape. `AgentOption`
 * now shares `AgentMetadata`'s `avatarUrl` field, so `AgentMetadata[]` is also
 * accepted by `<AgentPicker agents>` directly — this helper just drops the
 * fields the rows don't use.
 */
export function agentsToPickerOptions(agents: AgentMetadata[]): AgentOption[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    avatarUrl: agent.avatarUrl,
  }));
}

/** Props accepted by `<ChatAgentPicker>`. */
export interface ChatAgentPickerProps {
  /** Selected agent id (controlled). */
  value?: string;
  /** Called with the chosen agent id. */
  onValueChange?: (id: string) => void;
  /**
   * Minimum agent count before the picker renders. Defaults to `2` — with one
   * agent there is nothing to switch to. Set to `1` to always show it once an
   * agent is available.
   */
  minAgents?: number;
  /** When `false`, skips the fetch and renders nothing. Defaults to `true`. */
  enabled?: boolean;
  /** Shows a "Create Agent" row at the bottom of the list. */
  onCreate?: () => void;
  /** Shows a "Manage Agents" row at the bottom of the list. */
  onManage?: () => void;
  /** Additional class names for the trigger. */
  className?: string;
}

/** Render the connected agent switcher, or nothing when there's nothing to switch. */
export function ChatAgentPicker({
  value,
  onValueChange,
  minAgents = 2,
  enabled = true,
  onCreate,
  onManage,
  className,
}: ChatAgentPickerProps): React.ReactElement | null {
  const { agents } = useAgents({ enabled });
  const options = React.useMemo(() => agentsToPickerOptions(agents), [agents]);

  if (options.length < minAgents) return null;

  return (
    <AgentPicker
      agents={options}
      value={value}
      onValueChange={onValueChange}
      {...(onCreate ? { onCreate } : {})}
      {...(onManage ? { onManage } : {})}
      {...(className ? { className } : {})}
    />
  );
}
