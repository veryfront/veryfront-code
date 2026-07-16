/**
 * AgentPicker — Popover + Command combobox for switching the active agent.
 * Forked dependency-light 1:1 from Veryfront Studio's `AgentPicker`: a Pill (or
 * input-style) trigger opens a searchable list of agent rows (Avatar + name),
 * a Check marks the selection, and optional "Create Agent" / "Manage Agents"
 * affordances sit at the bottom. Studio's mobile `Drawer`/`ResponsiveSwitch`
 * branch is dropped (Studio-only deps) — the overlay always portals via our
 * `Floating` (through `PopoverContent`) so it never clips in the iframe.
 *
 * Semantic Studio classes use Veryfront tokens and private UI primitives.
 *
 * @module react/components/chat/agent-picker
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
import { Avatar } from "../ui/avatar.tsx";
import { CheckIcon, ChevronDownIcon } from "../ui/icons/index.ts";
import {
  AgentPickerContext,
  type AgentPickerContextValue,
  useAgentPicker,
} from "./agent-picker-context.tsx";
import {
  type AgentPickerActionProps,
  AgentPickerCreate,
  AgentPickerManage,
} from "./agent-picker-actions.tsx";

export type { AgentPickerActionProps, AgentPickerContextValue };
export { useAgentPicker };

/** A selectable agent entry. */
export interface AgentOption {
  /** Stable identifier — used as the selection value. */
  id: string;
  /** Display name (also the search keyword). */
  name: string;
  /** Avatar image URL (matches `AgentMetadata.avatarUrl`); initials shown when absent/null. */
  avatarUrl?: string | null;
  /** @deprecated Use `avatarUrl`. */
  avatarSrc?: string;
  /** Dims the row and blocks selection. */
  disabled?: boolean;
}

/** A labelled group of agents (e.g. "Connected Agents"). */
export interface AgentPickerSection {
  /** Omit to render an unlabelled group. */
  label?: string;
  agents: AgentOption[];
}

/** Props accepted by `<AgentPicker>`. */
export interface AgentPickerProps {
  /** Agents shown in the default (top) group. */
  agents: AgentOption[];
  /** Selected agent id. */
  value?: string;
  /** Called with the chosen agent id. */
  onValueChange?: (id: string) => void;
  /** Extra labelled groups rendered below the default group. */
  sections?: AgentPickerSection[];
  /** Shows a "Manage Agents" row at the bottom when provided. */
  onManage?: () => void;
  /** Shows a "Create Agent" row at the bottom when provided. */
  onCreate?: () => void;
  /** Notified whenever the popover opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Render the trigger as an input-style field instead of a pill. */
  inputStyle?: boolean;
  /** Mark the input-style trigger invalid. */
  invalid?: boolean;
  /** Show skeleton rows while agents are being fetched. */
  isLoading?: boolean;
  /** Additional class names for the trigger. */
  className?: string;
  /**
   * Compose your own menu from `AgentPicker.Trigger` / `Content` / `List` /
   * `Item`. When omitted, the default data-driven preset is rendered.
   */
  children?: React.ReactNode;
}

/** Search box appears once the combined agent count crosses this. */
const SEARCH_THRESHOLD = 5;

const LOADING_ROW_WIDTHS = ["w-3/5", "w-3/4", "w-2/3"] as const;

function totalAgentCount(
  agents: AgentOption[],
  sections: AgentPickerSection[],
): number {
  return agents.length +
    sections.reduce((acc, section) => acc + section.agents.length, 0);
}

function findAgent(
  id: string | undefined,
  agents: AgentOption[],
  sections: AgentPickerSection[],
): AgentOption | undefined {
  if (id === undefined) return undefined;
  const top = agents.find((agent) => agent.id === id);
  if (top) return top;
  for (const section of sections) {
    const hit = section.agents.find((agent) => agent.id === id);
    if (hit) return hit;
  }
  return undefined;
}

function AgentPickerLoadingRows(): React.ReactElement {
  return (
    <output aria-label="Loading agents" className="block px-1 py-1">
      <span className="sr-only">Loading agents</span>
      {LOADING_ROW_WIDTHS.map((widthClass, index) => (
        <div
          key={`${index}-${widthClass}`}
          aria-hidden="true"
          className="flex items-center gap-3 px-3 py-2"
        >
          <div className="size-5 shrink-0 rounded-full bg-[var(--accent)] animate-pulse" />
          <div
            className={cn(
              "h-3 rounded-md bg-[var(--accent)] animate-pulse",
              widthClass,
            )}
          />
        </div>
      ))}
    </output>
  );
}

// ---------------------------------------------------------------------------
// AgentPicker — compound, render-or-compose (mirrors `ToolCall`).
//
// `<AgentPicker agents={...} value={...} onValueChange={...} />` renders the
// default data-driven combobox (pill/input trigger + searchable agent list).
// Pass children to recompose the menu from `AgentPicker.Trigger`,
// `AgentPicker.Content`, `AgentPicker.List`, `AgentPicker.Item` — each reads
// `useAgentPicker()` for the shared selection + open state. Every sub-part
// takes `className` merged LAST via `cn`. The preset keeps working unchanged
// when no children are passed.
//
// The private `Popover` / `Command` primitives are composed, not modified: the
// composed tree renders a real `<Popover>` (from Root) whose context flows to
// `Trigger` (a `PopoverTrigger`) and `Content` (a `PopoverContent` + `Command`),
// and `Command` context flows from `Content` down to `List` / `Item`.
// ---------------------------------------------------------------------------

/** Props for `AgentPicker.Trigger` — the pill/input combobox button. */
export interface AgentPickerTriggerProps {
  /** Render as an input-style field instead of a pill. */
  inputStyle?: boolean;
  /** Mark the input-style trigger invalid. */
  invalid?: boolean;
  /** Override the trailing chevron glyph. */
  icon?: React.ReactNode;
  /** Override the trigger contents; defaults to the selected agent's row. */
  children?: React.ReactNode;
  className?: string;
}

/** The pill (or input-style) combobox trigger. Toggles the popover. */
function AgentPickerTrigger(
  { inputStyle = false, invalid = false, icon, children, className }: AgentPickerTriggerProps,
): React.ReactElement {
  const { value } = useAgentPicker();
  const sections = React.useContext(AgentDataContext);
  const selected = sections ? findAgent(value, sections.agents, sections.sections) : undefined;
  const triggerLabel = selected?.name ?? "Select agent";

  const content = children ?? (
    <>
      {selected && (
        <Avatar
          name={selected.name}
          avatarSrc={selected.avatarUrl ?? selected.avatarSrc}
          tone="muted"
          aria-hidden="true"
          className="size-5! bg-[var(--background)]"
        />
      )}
      <span className="min-w-0 truncate">{triggerLabel}</span>
      {inputStyle
        ? (icon ?? <ChevronDownIcon className="ml-auto size-3.5 opacity-50" />)
        : (icon ?? <ChevronDownIcon className="ml-auto" />)}
    </>
  );

  const trigger = inputStyle
    ? (
      <button
        type="button"
        data-invalid={invalid || undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] h-[50px] px-3 text-base text-[var(--foreground)]",
          "data-[invalid=true]:border-[var(--status-error)]",
          className,
        )}
      >
        {content}
      </button>
    )
    : (
      <Pill className={cn("min-w-0 max-w-full", className)}>
        {content}
      </Pill>
    );

  return <PopoverTrigger asChild>{trigger}</PopoverTrigger>;
}
AgentPickerTrigger.displayName = "AgentPicker.Trigger";

/** Props for `AgentPicker.Search` — the addressable search input leaf. */
export interface AgentPickerSearchProps {
  /** Search input placeholder. */
  placeholder?: string;
  className?: string;
}

/**
 * The search input row. An addressable leaf so a consumer composing
 * `AgentPicker.Content` can place / restyle / omit it. Reads the filter query
 * state straight from the enclosing `Command` context (via `CommandInput`) —
 * no prop-drilling. This is the same markup `AgentPicker.Content` renders for
 * its default (search-gated) anatomy.
 */
function AgentPickerSearch(
  { placeholder = "Search agents...", className }: AgentPickerSearchProps,
): React.ReactElement {
  return <CommandInput placeholder={placeholder} className={className} />;
}
AgentPickerSearch.displayName = "AgentPicker.Search";

/** Props for `AgentPicker.Content` — the popover surface + `Command` shell. */
export interface AgentPickerContentProps {
  children?: React.ReactNode;
  className?: string;
}

/** The popover surface wrapping a `Command` (search + list region). */
function AgentPickerContent(
  { children, className }: AgentPickerContentProps,
): React.ReactElement {
  return (
    <PopoverContent
      align="start"
      className={cn("min-w-[280px] p-0! rounded-lg", className)}
    >
      <Command className="bg-transparent">
        {children}
      </Command>
    </PopoverContent>
  );
}
AgentPickerContent.displayName = "AgentPicker.Content";

/** The scrollable `Command` list region. */
function AgentPickerList(
  { children, className }: { children?: React.ReactNode; className?: string },
): React.ReactElement {
  return (
    <CommandList className={cn("max-h-[320px]", className)}>
      {children}
    </CommandList>
  );
}
AgentPickerList.displayName = "AgentPicker.List";

/** Props for `AgentPicker.Item` — a single selectable agent row. */
export interface AgentPickerItemProps {
  /** The agent this row represents. Its `id` is the selection value. */
  agent: AgentOption;
  /** Force selected styling; defaults to matching the context `value`. */
  selected?: boolean;
  /** Override the selection-check glyph. */
  icon?: React.ReactNode;
  className?: string;
}

/** A single agent row (Avatar + name + selection check). */
function AgentPickerItem(
  { agent, selected, icon, className }: AgentPickerItemProps,
): React.ReactElement {
  const { value, onSelect } = useAgentPicker();
  const isSelected = selected ?? agent.id === value;
  return (
    <CommandItem
      value={agent.name}
      disabled={agent.disabled}
      onSelect={() => onSelect(agent.id)}
      className={className}
    >
      <Avatar
        name={agent.name}
        avatarSrc={agent.avatarUrl ?? agent.avatarSrc}
        tone="muted"
        aria-hidden="true"
        className="size-5! bg-[var(--background)]"
      />
      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
      {isSelected &&
        (icon ?? <CheckIcon className="ml-auto opacity-70" />)}
    </CommandItem>
  );
}
AgentPickerItem.displayName = "AgentPicker.Item";

/**
 * Data passed down so the default `Trigger` can resolve the selected label from
 * the preset `agents` / `sections`. Only populated on the preset (childless)
 * path; a fully-composed tree supplies its own trigger contents.
 */
const AgentDataContext = React.createContext<
  { agents: AgentOption[]; sections: AgentPickerSection[] } | null
>(null);

/** The default preset body — the data-driven groups + action rows. */
function AgentPickerPresetBody({
  agents,
  value,
  sections,
  isLoading,
}: {
  agents: AgentOption[];
  value?: string;
  sections: AgentPickerSection[];
  isLoading: boolean;
}): React.ReactElement {
  const { onCreate, onManage } = useAgentPicker();
  const hasSectionAgents = sections.some((section) => section.agents.length > 0);
  const showLoading = isLoading && !hasSectionAgents;

  return (
    <>
      {!showLoading && <CommandEmpty>No agents found.</CommandEmpty>}
      {agents.length > 0 && (
        <CommandGroup>
          {agents.map((agent) => (
            <AgentPickerItem
              key={agent.id}
              agent={agent}
              selected={agent.id === value}
            />
          ))}
        </CommandGroup>
      )}
      {showLoading && <AgentPickerLoadingRows />}
      {sections.map((section, index) => (
        <CommandGroup
          key={section.label ?? `section-${index}`}
          heading={section.label}
        >
          {section.agents.map((agent) => (
            <AgentPickerItem
              key={agent.id}
              agent={agent}
              selected={agent.id === value}
            />
          ))}
        </CommandGroup>
      ))}
      {(onCreate || onManage) && (
        <CommandGroup>
          <AgentPickerCreate />
          <AgentPickerManage />
        </CommandGroup>
      )}
    </>
  );
}

/**
 * `AgentPicker.Root` — context provider + the popover shell. No children
 * renders the default data-driven preset; pass children to recompose from
 * `AgentPicker.Trigger` / `Content` / `List` / `Item`.
 */
function AgentPickerRoot({
  agents,
  value,
  onValueChange,
  sections = [],
  onManage,
  onCreate,
  onOpenChange,
  inputStyle = false,
  invalid = false,
  isLoading = false,
  className,
  children,
}: AgentPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const showSearch = totalAgentCount(agents, sections) > SEARCH_THRESHOLD;

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  const handleSelect = React.useCallback(
    (id: string) => {
      handleOpenChange(false);
      onValueChange?.(id);
    },
    [handleOpenChange, onValueChange],
  );

  const handleManage = React.useCallback(() => {
    handleOpenChange(false);
    onManage?.();
  }, [handleOpenChange, onManage]);

  const handleCreate = React.useCallback(() => {
    handleOpenChange(false);
    onCreate?.();
  }, [handleOpenChange, onCreate]);

  // Memoized so consumers don't re-render on every parent render (F-3). The
  // callbacks are already stable (useCallback above).
  const context = React.useMemo<AgentPickerContextValue>(
    () => ({
      value,
      onSelect: handleSelect,
      open,
      setOpen: handleOpenChange,
      onCreate: onCreate ? handleCreate : undefined,
      onManage: onManage ? handleManage : undefined,
    }),
    [
      value,
      handleSelect,
      open,
      handleOpenChange,
      onCreate,
      handleCreate,
      onManage,
      handleManage,
    ],
  );
  const agentData = React.useMemo(() => ({ agents, sections }), [agents, sections]);

  return (
    <AgentPickerContext.Provider value={context}>
      <AgentDataContext.Provider value={agentData}>
        <Popover open={open} onOpenChange={handleOpenChange}>
          {children ?? (
            <>
              <AgentPickerTrigger
                inputStyle={inputStyle}
                invalid={invalid}
                className={className}
              />
              <AgentPickerContent>
                {showSearch && <AgentPickerSearch />}
                <AgentPickerList>
                  <AgentPickerPresetBody
                    agents={agents}
                    value={value}
                    sections={sections}
                    isLoading={isLoading}
                  />
                </AgentPickerList>
              </AgentPickerContent>
            </>
          )}
        </Popover>
      </AgentDataContext.Provider>
    </AgentPickerContext.Provider>
  );
}
AgentPickerRoot.displayName = "AgentPicker.Root";

/**
 * AgentPicker — render `<AgentPicker agents={...} .../>` for the default
 * data-driven combobox, or compose `AgentPicker.Trigger`, `Content`, `Search`,
 * `List`, `Item`, `Create`, and `Manage` for a custom menu.
 */
export const AgentPicker = Object.assign(AgentPickerRoot, {
  Root: AgentPickerRoot,
  Trigger: AgentPickerTrigger,
  Content: AgentPickerContent,
  Search: AgentPickerSearch,
  List: AgentPickerList,
  Item: AgentPickerItem,
  Create: AgentPickerCreate,
  Manage: AgentPickerManage,
});
