import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";

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

export const AgentPickerContext = React.createContext<AgentPickerContextValue | null>(null);

/** Read the enclosing `AgentPicker` state. */
export function useAgentPicker(): AgentPickerContextValue {
  const context = React.useContext(AgentPickerContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "useAgentPicker must be used within an AgentPicker",
    });
  }
  return context;
}
