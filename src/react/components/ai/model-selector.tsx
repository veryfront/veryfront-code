/**
 * ModelSelector - Dropdown for switching models at runtime
 *
 * Opens downward from the trigger using fixed positioning
 * so it never affects the surrounding layout.
 *
 * Implements WAI-ARIA listbox pattern with full keyboard navigation.
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
  const [focusedIndex, setFocusedIndex] = React.useState(-1);

  const selected = models.find((m) => m.value === value) ?? models[0];
  const listboxId = React.useId();

  // Measure trigger and position dropdown below it, right-aligned
  React.useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      right: globalThis.innerWidth - r.right,
    });
    // Focus the selected item when opening
    const selectedIdx = models.findIndex((m) => m.value === (value ?? selected?.value));
    setFocusedIndex(selectedIdx >= 0 ? selectedIdx : 0);
  }, [open, models, value, selected?.value]);

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

  // Keyboard navigation
  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent): void {
      switch (e.key) {
        case "Escape":
          setOpen(false);
          triggerRef.current?.focus();
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % models.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((prev) => (prev - 1 + models.length) % models.length);
          break;
        case "Home":
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          e.preventDefault();
          setFocusedIndex(models.length - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < models.length) {
            onChange(models[focusedIndex]!.value);
            setOpen(false);
            triggerRef.current?.focus();
          }
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, focusedIndex, models, onChange]);

  // Scroll focused item into view
  React.useEffect(() => {
    if (!open || focusedIndex < 0) return;
    const option = dropdownRef.current?.querySelector(`[data-index="${focusedIndex}"]`);
    option?.scrollIntoView({ block: "nearest" });
  }, [open, focusedIndex]);

  const hasGroups = models.some((m) => m.provider);
  const groups = hasGroups ? groupByProvider(models) : null;

  function handleSelect(model: ModelOption): void {
    onChange(model.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function renderItem(model: ModelOption, flatIndex: number): React.ReactElement {
    const isActive = model.value === (value ?? selected?.value);
    const isFocused = flatIndex === focusedIndex;

    return (
      <div
        key={model.value}
        role="option"
        aria-selected={isActive}
        data-index={flatIndex}
        onClick={() => handleSelect(model)}
        onMouseEnter={() => setFocusedIndex(flatIndex)}
        className={cn(
          "w-full text-left px-3 py-2 text-sm transition-colors rounded-lg cursor-pointer",
          isActive
            ? "bg-[var(--accent)] text-[var(--foreground)]"
            : "text-[var(--card-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
          isFocused && !isActive && "bg-[var(--accent)]",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">{model.label}</span>
          {model.badge && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-[var(--accent)] text-[var(--foreground)]">
              {model.badge}
            </span>
          )}
        </div>
        {model.description && (
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {model.description}
          </p>
        )}
      </div>
    );
  }

  // Build flat index mapping for grouped layout
  let flatIndex = 0;
  const dropdownContent = groups
    ? Array.from(groups.entries()).map(([provider, items], groupIndex) => (
      <div key={provider || "__ungrouped"} role="group" aria-label={provider || undefined}>
        {groupIndex > 0 && <div className="h-px bg-[var(--border)] my-1" />}
        {provider && (
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--input-placeholder)]">
            {provider}
          </div>
        )}
        {items.map((item) =>
          renderItem(item, flatIndex++)
        )}
      </div>
    ))
    : models.map((item) => renderItem(item, flatIndex++));

  return (
    <div className={cn("inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full",
          "border border-[var(--border)]",
          "bg-[var(--card)]",
          "text-[var(--card-foreground)]",
          "hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
          "transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        <span>{selected?.label ?? "Select model"}</span>
        <ChevronDownIcon className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && pos && (
        <div
          ref={dropdownRef}
          id={listboxId}
          role="listbox"
          aria-label="Select model"
          className="min-w-[220px] max-h-[320px] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl p-1"
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
