/**
 * AgentPicker — Popover + Command combobox for switching the active agent.
 * Forked dependency-light 1:1 from Veryfront Studio's `AgentPicker`: a Pill (or
 * input-style) trigger opens a searchable list of agent rows (Avatar + name),
 * a Check marks the selection, and optional "Create Agent" / "Manage Agents"
 * affordances sit at the bottom. Studio's mobile `Drawer`/`ResponsiveSwitch`
 * branch is dropped (Studio-only deps) — the overlay always portals via our
 * `Floating` (through `PopoverContent`) so it never clips in the iframe.
 *
 * Semantic Studio classes remapped to veryfront's `[var(--token)]` vocabulary;
 * icons inherit the Command row's sizing. Composes the private chat/ui
 * primitives (Popover, Command, Avatar) — no radix / cva / `@/` imports.
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
} from "./ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { Pill } from "./ui/pill.tsx";
import { Avatar } from "./ui/avatar.tsx";
import { CheckIcon, ChevronDownIcon, PlusIcon, SparklesIcon } from "./icons/index.ts";

/** A selectable agent entry. */
export interface AgentOption {
  /** Stable identifier — used as the selection value. */
  id: string;
  /** Display name (also the search keyword). */
  name: string;
  /** Avatar image URL; initials are shown when absent. */
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

/**
 * Icon overrides for {@link AgentPicker}. Each defaults to the built-in glyph.
 */
export interface AgentPickerIcons {
  check?: React.ReactNode;
  chevron?: React.ReactNode;
  create?: React.ReactNode;
  more?: React.ReactNode;
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
  /** Override any of the picker icons. */
  icons?: AgentPickerIcons;
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

function AgentRow({
  agent,
  selected,
  onSelect,
  checkIcon,
}: {
  agent: AgentOption;
  selected: boolean;
  onSelect: (id: string) => void;
  checkIcon?: React.ReactNode;
}): React.ReactElement {
  return (
    <CommandItem
      value={agent.name}
      disabled={agent.disabled}
      onSelect={() => onSelect(agent.id)}
    >
      <Avatar
        name={agent.name}
        avatarSrc={agent.avatarSrc}
        tone="muted"
        aria-hidden="true"
        className="size-5! bg-[var(--background)]"
      />
      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
      {selected &&
        (checkIcon ?? <CheckIcon className="ml-auto opacity-70" />)}
    </CommandItem>
  );
}

/** Render the agent switcher. */
export function AgentPicker({
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
  icons,
}: AgentPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const showSearch = totalAgentCount(agents, sections) > SEARCH_THRESHOLD;
  const hasSectionAgents = sections.some((section) => section.agents.length > 0);
  const showLoading = isLoading && !hasSectionAgents;

  const selected = findAgent(value, agents, sections);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  const handleSelect = (id: string) => {
    handleOpenChange(false);
    onValueChange?.(id);
  };

  const handleManage = () => {
    handleOpenChange(false);
    onManage?.();
  };

  const handleCreate = () => {
    handleOpenChange(false);
    onCreate?.();
  };

  const triggerLabel = selected?.name ?? "Select agent";

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
        {selected && (
          <Avatar
            name={selected.name}
            avatarSrc={selected.avatarSrc}
            tone="muted"
            aria-hidden="true"
            className="size-5! bg-[var(--background)]"
          />
        )}
        <span className="min-w-0 truncate">{triggerLabel}</span>
        {icons?.chevron ?? <ChevronDownIcon className="ml-auto size-3.5 opacity-50" />}
      </button>
    )
    : (
      <Pill className={cn("min-w-0 max-w-full", className)}>
        {selected && (
          <Avatar
            name={selected.name}
            avatarSrc={selected.avatarSrc}
            tone="muted"
            aria-hidden="true"
            className="size-5! bg-[var(--background)]"
          />
        )}
        <span className="min-w-0 truncate">{triggerLabel}</span>
        {icons?.chevron ?? <ChevronDownIcon className="ml-auto" />}
      </Pill>
    );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="min-w-[280px] p-0! rounded-lg"
      >
        <Command className="bg-transparent">
          {showSearch && <CommandInput placeholder="Search agents..." />}
          <CommandList className="max-h-[320px]">
            {!showLoading && <CommandEmpty>No agents found.</CommandEmpty>}
            {agents.length > 0 && (
              <CommandGroup>
                {agents.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    selected={agent.id === value}
                    onSelect={handleSelect}
                    checkIcon={icons?.check}
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
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    selected={agent.id === value}
                    onSelect={handleSelect}
                    checkIcon={icons?.check}
                  />
                ))}
              </CommandGroup>
            ))}
            {(onCreate || onManage) && (
              <CommandGroup>
                {onCreate && (
                  <CommandItem value="Create Agent" onSelect={handleCreate}>
                    {icons?.create ?? <PlusIcon />}
                    Create Agent
                  </CommandItem>
                )}
                {onManage && (
                  <CommandItem value="Manage Agents" onSelect={handleManage}>
                    {icons?.more ?? <SparklesIcon />}
                    Manage Agents
                  </CommandItem>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
