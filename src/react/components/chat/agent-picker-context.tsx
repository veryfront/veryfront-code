import { createStrictContext } from "../create-strict-context.ts";

/** Shared selection and open state exposed to `AgentPicker.*` sub-parts. */
export interface AgentPickerContextValue {
  /** Selected agent id. */
  value?: string;
  /** Select an agent by id and close the menu. */
  onSelect: (id: string) => void;
  /** Popover open state. */
  open: boolean;
  /** Set the popover open state and notify `onOpenChange`. */
  setOpen: (open: boolean) => void;
  /** Create an agent and close the menu when the action is available. */
  onCreate?: () => void;
  /** Manage agents and close the menu when the action is available. */
  onManage?: () => void;
}

const [AgentPickerContext, useAgentPickerStrict] = createStrictContext<AgentPickerContextValue>(
  "useAgentPicker",
  "an AgentPicker",
);

/**
 * Read the enclosing `<AgentPicker>`'s selection and open state (selected id,
 * `onSelect`, `open`/`setOpen`, and the optional `onCreate`/`onManage`
 * actions) from a custom sub-part. Throws when used outside an `AgentPicker`.
 *
 * @example
 * ```tsx
 * function AgentPickerTrigger() {
 *   const { open, setOpen, value } = useAgentPicker();
 *   return <button onClick={() => setOpen(!open)}>{value ?? "Pick agent"}</button>;
 * }
 * ```
 */
export const useAgentPicker = useAgentPickerStrict;

export { AgentPickerContext };
