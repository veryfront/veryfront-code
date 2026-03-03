/**
 * ModelSelector - Dropdown for switching models at runtime
 *
 * Opens downward from the trigger using fixed positioning
 * so it never affects the surrounding layout.
 */

import * as React from "react";
import { cn } from "./theme.ts";
import { ChevronDownIcon } from "./icons/index.ts";

/** A "provider/model" value and its display label. */
export interface ModelOption {
  /** "provider/model" string (e.g. "openai/gpt-4o") */
  value: string;
  /** Display label (e.g. "GPT-4o") */
  label: string;
  /** Provider name for grouping (e.g. "openai") */
  provider?: string;
  /** Short description shown beneath the label */
  description?: string;
  /** Badge text (e.g. "Local", "New") */
  badge?: string;
}

/** Props for `<ModelSelector>`. */
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

function groupByProvider(models: ModelOption[]): Map<string, ModelOption[]> {
  const groups = new Map<string, ModelOption[]>();
  for (const model of models) {
    const key = model.provider ?? "";
    const group = groups.get(key);
    if (group) {
      group.push(model);
    } else {
      groups.set(key, [model]);
    }
  }
  return groups;
}

export function ModelSelector({
  models,
  value,
  onChange,
  className,
  disabled,
}: ModelSelectorProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; right: number } | null>(null);

  const selected = models.find((m) => m.value === value) ?? models[0];

  // Measure trigger and position dropdown below it, right-aligned
  React.useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      right: window.innerWidth - r.right,
    });
  }, [open]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent): void {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const hasGroups = models.some((m) => m.provider);
  const groups = hasGroups ? groupByProvider(models) : null;

  function handleSelect(model: ModelOption): void {
    onChange(model.value);
    setOpen(false);
  }

  function renderItem(model: ModelOption): React.ReactElement {
    const isActive = model.value === (value ?? selected?.value);

    return (
      <button
        key={model.value}
        type="button"
        onClick={() => handleSelect(model)}
        className={cn(
          "w-full text-left px-3 py-2 text-sm transition-colors rounded-lg",
          isActive
            ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
            : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">{model.label}</span>
          {model.badge && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              {model.badge}
            </span>
          )}
        </div>
        {model.description && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{model.description}</p>
        )}
      </button>
    );
  }

  const dropdownContent = groups
    ? Array.from(groups.entries()).map(([provider, items], groupIndex) => (
      <div key={provider || "__ungrouped"}>
        {groupIndex > 0 && (
          <div className="h-px bg-neutral-100 dark:bg-neutral-800 my-1" />
        )}
        {provider && (
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            {provider}
          </div>
        )}
        {items.map(renderItem)}
      </div>
    ))
    : models.map(renderItem);

  return (
    <div className={cn("inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full",
          "border border-neutral-200 dark:border-neutral-700",
          "bg-white dark:bg-neutral-800",
          "text-neutral-600 dark:text-neutral-400",
          "hover:bg-neutral-50 dark:hover:bg-neutral-750 hover:text-neutral-800 dark:hover:text-neutral-200",
          "focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:focus:ring-neutral-700",
          "transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        <span>{selected?.label ?? "Select model"}</span>
        <ChevronDownIcon className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && pos && (
        <div
          ref={dropdownRef}
          className="min-w-[220px] max-h-[320px] overflow-auto rounded-xl border border-neutral-200/80 dark:border-neutral-700/80 bg-white dark:bg-neutral-900 shadow-xl p-1"
          style={{
            position: "fixed",
            top: pos.top,
            right: pos.right,
            zIndex: 9999,
          }}
        >
          {dropdownContent}
        </div>
      )}
    </div>
  );
}
