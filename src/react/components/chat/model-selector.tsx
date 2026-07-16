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
} from "../ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { Pill } from "../ui/pill.tsx";
import { CheckIcon, ChevronDownIcon, SparklesIcon } from "../ui/icons/index.ts";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";

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
   * Render each model yourself instead of using `ModelSelector.Item`.
   */
  renderItem?: (
    options: { item: ModelOption; index: number },
  ) => React.ReactNode;
  /**
   * Compose your own menu from `ModelSelector.Trigger` / `Content` / `List` /
   * `Item`. When omitted, the default data-driven preset is rendered.
   */
  children?: React.ReactNode;
}

/** Search box appears once the model count crosses this. */
const SEARCH_THRESHOLD = 6;

interface IndexedModelOption {
  item: ModelOption;
  index: number;
}

function groupByProvider(models: ModelOption[]): Map<string, IndexedModelOption[]> {
  const groups = new Map<string, IndexedModelOption[]>();
  for (const [index, item] of models.entries()) {
    const key = item.provider ?? "";
    const group = groups.get(key);
    if (group) {
      group.push({ item, index });
    } else {
      groups.set(key, [{ item, index }]);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// ModelSelector — compound, render-or-compose (mirrors `ToolCall`).
//
// `<ModelSelector models={...} value={...} onChange={...} />` renders the
// default data-driven combobox (pill/icon trigger + provider-grouped list).
// Pass children to recompose from `ModelSelector.Trigger` / `Content` / `Search`
// / `List` / `Item`: each reads `useModelSelector()` for the shared selection + open
// state. Every sub-part takes `className` merged LAST via `cn`. The preset keeps
// working unchanged when no children are passed.
//
// The private `Popover` / `Command` primitives are composed, not modified: the
// composed tree renders a real `<Popover>` (from Root) whose context flows to
// `Trigger` (a `PopoverTrigger`) and `Content` (a `PopoverContent` + `Command`),
// and `Command` context flows from `Content` down to `List` / `Item`.
// ---------------------------------------------------------------------------

/** Shared selection + open state exposed to `ModelSelector.*` sub-parts. */
export interface ModelSelectorContextValue {
  /** Selected model value ("provider/model"). */
  value?: string;
  /** The resolved selected option (from `value`, else the first model). */
  selectedModel?: ModelOption;
  /** @deprecated Use `selectedModel`. */
  selected?: ModelOption;
  /** Select a model by value (also closes the menu). */
  onSelect: (value: string) => void;
  /** Popover open state. */
  open: boolean;
  /** Set the popover open state. */
  setOpen: (open: boolean) => void;
  /** Whether the selector is disabled. */
  disabled?: boolean;
}

const ModelSelectorContext = React.createContext<
  ModelSelectorContextValue | null
>(null);

/**
 * Read the enclosing `ModelSelector` selection + open state. Throws when used
 * outside a `<ModelSelector>`.
 */
export function useModelSelector(): ModelSelectorContextValue {
  const ctx = React.useContext(ModelSelectorContext);
  if (!ctx) {
    throw COMPONENT_ERROR.create({
      detail: "useModelSelector must be used within a ModelSelector",
    });
  }
  return ctx;
}

/** Props for `ModelSelector.Trigger` — the pill/icon combobox button. */
export interface ModelSelectorTriggerProps {
  /** Trigger style. @default "pill" */
  variant?: "pill" | "icon";
  /** Override the trigger contents; defaults to the selected model. */
  children?: React.ReactNode;
  className?: string;
}

/** The pill (or icon) combobox trigger. Toggles the popover. */
function ModelSelectorTrigger(
  { variant = "pill", children, className }: ModelSelectorTriggerProps,
): React.ReactElement {
  const { selectedModel, disabled } = useModelSelector();

  const trigger = children
    ? (
      <button type="button" disabled={disabled} className={className}>
        {children}
      </button>
    )
    : variant === "icon"
    ? (
      <button
        type="button"
        disabled={disabled}
        aria-label={selectedModel?.label ?? "Select model"}
        className={cn(
          "flex size-9 items-center justify-center rounded-full text-[var(--foreground)] transition-colors hover:bg-[var(--tertiary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
      >
        <ProviderLogo provider={providerOf(selectedModel)} className="size-5" />
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
        <ProviderLogo provider={providerOf(selectedModel)} className="size-4" />
        <span className="min-w-0 truncate">
          {selectedModel?.label ?? "Select model"}
        </span>
        <ChevronDownIcon className="ml-auto" />
      </Pill>
    );

  return <PopoverTrigger asChild>{trigger}</PopoverTrigger>;
}
ModelSelectorTrigger.displayName = "ModelSelector.Trigger";

/** Props for `ModelSelector.Search`, the addressable search input leaf. */
export interface ModelSelectorSearchProps {
  /** Search input placeholder. */
  placeholder?: string;
  className?: string;
}

/** Search input for a composed model menu. */
function ModelSelectorSearch(
  { placeholder = "Search models...", className }: ModelSelectorSearchProps,
): React.ReactElement {
  return <CommandInput placeholder={placeholder} className={className} />;
}
ModelSelectorSearch.displayName = "ModelSelector.Search";

/** Props for `ModelSelector.Content` — the popover surface + `Command` shell. */
export interface ModelSelectorContentProps {
  children?: React.ReactNode;
  className?: string;
}

/** The popover surface wrapping a `Command` (search + list region). */
function ModelSelectorContent(
  { children, className }: ModelSelectorContentProps,
): React.ReactElement {
  return (
    <PopoverContent
      align="start"
      className={cn("min-w-[260px] p-0! rounded-lg", className)}
    >
      <Command className="bg-transparent">
        {children}
      </Command>
    </PopoverContent>
  );
}
ModelSelectorContent.displayName = "ModelSelector.Content";

/** The scrollable `Command` list region. */
function ModelSelectorList(
  { children, className }: { children?: React.ReactNode; className?: string },
): React.ReactElement {
  return (
    <CommandList className={cn("max-h-[320px]", className)}>
      {children}
    </CommandList>
  );
}
ModelSelectorList.displayName = "ModelSelector.List";

/** Props for `ModelSelector.Item` — a single selectable model row. */
export interface ModelSelectorItemProps {
  /** The model this row represents. Its `value` is the selection value. */
  model: ModelOption;
  /** Force selected styling; defaults to matching the context `value`. */
  selected?: boolean;
  className?: string;
}

/** A single model row (provider logo + label + optional badge + check). */
function ModelSelectorItem(
  { model, selected, className }: ModelSelectorItemProps,
): React.ReactElement {
  const { value, selectedModel, onSelect } = useModelSelector();
  const selectedValue = value ?? selectedModel?.value;
  const isSelected = selected ?? model.value === selectedValue;
  return (
    <CommandItem
      value={model.label}
      onSelect={() => onSelect(model.value)}
      className={className}
    >
      <ProviderLogo provider={providerOf(model)} className="size-4.5" />
      <span className="min-w-0 flex-1 truncate">{model.label}</span>
      {model.badge && (
        <span className="rounded-full border border-[var(--outline-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--faint)]">
          {model.badge}
        </span>
      )}
      {isSelected && <CheckIcon className="ml-auto opacity-70" />}
    </CommandItem>
  );
}
ModelSelectorItem.displayName = "ModelSelector.Item";

/** The default preset body — provider-grouped model rows. */
function ModelSelectorPresetBody({
  models,
  selectedValue,
  renderItem,
}: {
  models: ModelOption[];
  selectedValue?: string;
  renderItem?: ModelSelectorProps["renderItem"];
}): React.ReactElement {
  const hasGroups = models.some((m) => m.provider);
  const groups = hasGroups ? groupByProvider(models) : null;

  function renderModel(model: ModelOption, index: number): React.ReactNode {
    const isSelected = model.value === selectedValue;
    if (renderItem) {
      return (
        <React.Fragment key={model.value}>
          {renderItem({ item: model, index })}
        </React.Fragment>
      );
    }
    return (
      <ModelSelectorItem
        key={model.value}
        model={model}
        selected={isSelected}
      />
    );
  }

  return (
    <>
      <CommandEmpty>No models found.</CommandEmpty>
      {groups
        ? Array.from(groups.entries()).map(([provider, items]) => (
          <CommandGroup
            key={provider || "__ungrouped"}
            heading={provider || undefined}
          >
            {items.map(({ item, index }) => renderModel(item, index))}
          </CommandGroup>
        ))
        : (
          <CommandGroup>
            {models.map((model, index) => renderModel(model, index))}
          </CommandGroup>
        )}
    </>
  );
}

/**
 * `ModelSelector.Root` — context provider + the popover shell. No children
 * renders the default data-driven preset; pass children to recompose from
 * `ModelSelector.Trigger` / `Content` / `List` / `Item`.
 */
function ModelSelectorRoot({
  models,
  value,
  onChange,
  className,
  disabled,
  variant = "pill",
  renderItem,
  children,
}: ModelSelectorProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const selected = models.find((m) => m.value === value) ?? models[0];
  const selectedValue = value ?? selected?.value;
  const showSearch = models.length > SEARCH_THRESHOLD;

  const handleSelect = React.useCallback(
    (modelValue: string): void => {
      setOpen(false);
      onChange(modelValue);
    },
    [onChange],
  );

  const context: ModelSelectorContextValue = {
    value,
    selectedModel: selected,
    selected,
    onSelect: handleSelect,
    open,
    setOpen,
    disabled,
  };

  return (
    <ModelSelectorContext.Provider value={context}>
      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        {children ?? (
          <>
            <ModelSelectorTrigger variant={variant} className={className} />
            <ModelSelectorContent>
              {showSearch && <ModelSelectorSearch />}
              <ModelSelectorList>
                <ModelSelectorPresetBody
                  models={models}
                  selectedValue={selectedValue}
                  renderItem={renderItem}
                />
              </ModelSelectorList>
            </ModelSelectorContent>
          </>
        )}
      </Popover>
    </ModelSelectorContext.Provider>
  );
}
ModelSelectorRoot.displayName = "ModelSelector.Root";

/**
 * ModelSelector — render `<ModelSelector models={...} .../>` for the default
 * data-driven combobox, or compose `ModelSelector.Trigger`, `Content`, `Search`,
 * `List`, and `Item` for a custom menu.
 */
export const ModelSelector = Object.assign(ModelSelectorRoot, {
  Root: ModelSelectorRoot,
  Trigger: ModelSelectorTrigger,
  Content: ModelSelectorContent,
  Search: ModelSelectorSearch,
  List: ModelSelectorList,
  Item: ModelSelectorItem,
});
