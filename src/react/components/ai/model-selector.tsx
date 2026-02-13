/**
 * ModelSelector - Dropdown for switching models at runtime
 *
 * Renders a compact dropdown that integrates with useChat's model/setModel.
 * Expects "provider/model" strings (e.g. "openai/gpt-4o").
 */

import * as React from "react";

export interface ModelOption {
  /** "provider/model" string (e.g. "openai/gpt-4o") */
  value: string;
  /** Display label (e.g. "GPT-4o") */
  label: string;
}

export interface ModelSelectorProps {
  /** Available models */
  models: ModelOption[];
  /** Currently selected model (undefined = agent default) */
  value?: string;
  /** Called when user selects a model */
  onChange: (model: string) => void;
  /** Additional class names */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
}

export function ModelSelector({
  models,
  value,
  onChange,
  className,
  disabled,
}: ModelSelectorProps): React.ReactElement {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={className ??
        "text-xs px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 focus:outline-none focus:ring-1 focus:ring-neutral-400"}
    >
      {models.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
