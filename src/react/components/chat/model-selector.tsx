/**
 * ModelSelector — Popover + Command combobox for switching models at runtime.
 *
 * Built on the same primitives as `AgentPicker` (Popover → Command), so the
 * dropdown portals via `Floating` (never clips in the composer/iframe) and gets
 * keyboard nav + search for free. Rows show the real provider logo from
 * models.dev. Two trigger styles via `variant`: `pill` (logo + label + chevron)
 * or `icon` (logo only, like Studio's desktop picker).
 *
 * @module react/components/chat/model-selector
 */

import * as React from "react";
import { cn } from "./theme.ts";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { Pill } from "./ui/pill.tsx";
import { CheckIcon, ChevronDownIcon, SparklesIcon } from "./icons/index.ts";

/** Provider slug for a model (explicit `provider`, else the `value` prefix). */
function providerOf(model: ModelOption | undefined): string | undefined {
  return model?.provider ?? model?.value.split("/")[0];
}

/**
 * Real provider logo from models.dev (`dark:invert` for dark mode, same source
 * as Studio). Falls back to a generic glyph if the slug has no logo.
 */
function ProviderLogo(
  { provider, className }: { provider?: string; className?: string },
): React.ReactElement {
  const [failed, setFailed] = React.useState(false);
  const key = provider?.toLowerCase();
  if (!key || failed) {
    return <SparklesIcon className={cn("size-4.5 text-[var(--faint)]", className)} />;
  }
  return (
    <img
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("size-5 shrink-0 object-contain dark:invert", className)}
      src={`https://models.dev/logos/${key}.svg`}
    />
  );
}

/** A "provider/model" value and its display label. */
export interface ModelOption {
  /** "provider/model" string (e.g. "openai/gpt-4o") */
  value: string;
  /** Display label (e.g. "GPT-4o") */
  label: string;
  /** Provider name for grouping + logo (e.g. "openai") */
  provider?: string;
  /** Short description shown beneath the label */
  description?: string;
  /** Badge text (e.g. "Local", "New") */
  badge?: string;
}

/** Props accepted by `<ModelSelector>`. */
export interface ModelSelectorProps {
  /** Available models */
  models: ModelOption[];
  /** Currently selected model (undefined = agent default) */
  value?: string;
  /** Called when user selects a model */
  onChange: (model: string) => void;
  /** Additional class names for the trigger */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /**
   * Trigger style: `pill` (logo + label + chevron) or `icon` (provider logo
   * only, like Studio's desktop picker). @default "pill"
   */
  variant?: "pill" | "icon";
  /**
   * Custom trigger renderer. When provided, replaces the default pill/icon
   * trigger. `model` is the currently-selected option (resolved from `value`);
   * `open` is the popover open state. Rendered inside the existing
   * `PopoverTrigger asChild`, so the returned element still toggles the popover.
   */
  renderTrigger?: (
    opts: { model?: ModelOption; open: boolean },
  ) => React.ReactNode;
  /**
   * Custom row renderer. When provided, each option renders through it instead
   * of the default `ModelRow`. Wire `onSelect` to trigger selection (which also
   * closes the popover).
   */
  renderRow?: (
    opts: { model: ModelOption; selected: boolean; onSelect: () => void },
  ) => React.ReactNode;
}

/** Search box appears once the model count crosses this. */
const SEARCH_THRESHOLD = 6;

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

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: ModelOption;
  selected: boolean;
  onSelect: (value: string) => void;
}): React.ReactElement {
  return (
    <CommandItem
      value={model.label}
      onSelect={() => onSelect(model.value)}
    >
      <ProviderLogo provider={providerOf(model)} className="size-4.5" />
      <span className="min-w-0 flex-1 truncate">{model.label}</span>
      {model.badge && (
        <span className="rounded-full border border-[var(--outline-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--faint)]">
          {model.badge}
        </span>
      )}
      {selected && <CheckIcon className="ml-auto opacity-70" />}
    </CommandItem>
  );
}

/** Render model selector. */
export function ModelSelector({
  models,
  value,
  onChange,
  className,
  disabled,
  variant = "pill",
  renderTrigger,
  renderRow,
}: ModelSelectorProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const selected = models.find((m) => m.value === value) ?? models[0];
  const selectedValue = value ?? selected?.value;
  const showSearch = models.length > SEARCH_THRESHOLD;
  const hasGroups = models.some((m) => m.provider);
  const groups = hasGroups ? groupByProvider(models) : null;

  function handleSelect(modelValue: string): void {
    setOpen(false);
    onChange(modelValue);
  }

  function renderModel(model: ModelOption): React.ReactNode {
    const isSelected = model.value === selectedValue;
    if (renderRow) {
      return (
        <React.Fragment key={model.value}>
          {renderRow({
            model,
            selected: isSelected,
            onSelect: () => handleSelect(model.value),
          })}
        </React.Fragment>
      );
    }
    return (
      <ModelRow
        key={model.value}
        model={model}
        selected={isSelected}
        onSelect={handleSelect}
      />
    );
  }

  const trigger = renderTrigger
    ? renderTrigger({ model: selected, open })
    : variant === "icon"
    ? (
      <button
        type="button"
        disabled={disabled}
        aria-label={selected?.label ?? "Select model"}
        className={cn(
          "flex size-9 items-center justify-center rounded-full text-[var(--foreground)] transition-colors hover:bg-[var(--tertiary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
      >
        <ProviderLogo provider={providerOf(selected)} className="size-5" />
      </button>
    )
    : (
      <Pill
        className={cn(
          "min-w-0 max-w-full",
          disabled && "opacity-50 pointer-events-none",
          className,
        )}
      >
        <ProviderLogo provider={providerOf(selected)} className="size-4" />
        <span className="min-w-0 truncate">{selected?.label ?? "Select model"}</span>
        <ChevronDownIcon className="ml-auto" />
      </Pill>
    );

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="min-w-[260px] p-0! rounded-lg">
        <Command className="bg-transparent">
          {showSearch && <CommandInput placeholder="Search models..." />}
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No models found.</CommandEmpty>
            {groups
              ? Array.from(groups.entries()).map(([provider, items]) => (
                <CommandGroup
                  key={provider || "__ungrouped"}
                  heading={provider || undefined}
                >
                  {items.map((model) => renderModel(model))}
                </CommandGroup>
              ))
              : (
                <CommandGroup>
                  {models.map((model) => renderModel(model))}
                </CommandGroup>
              )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
