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

const [AgentPickerContext, useAgentPicker] = createStrictContext<AgentPickerContextValue>(
  "useAgentPicker",
  "an AgentPicker",
);
export { AgentPickerContext, useAgentPicker };
