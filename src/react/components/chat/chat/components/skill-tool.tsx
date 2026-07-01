/**
 * SkillTool — tool-call row for the `load_skill` skill tool.
 *
 * Rebuilt from the old `SkillBadge` pill into a tool-call ROW that reads as a
 * sibling of the other tool rows (see `tool-ui.tsx`). Forked dependency-light
 * from Studio's `LoadSkillTool` → `ChatTool` (no radix / cva-from-Studio / `@/`
 * imports, no licensed fonts). Variants are built with our private `ui/cva.ts`.
 *
 * Studio labels (from `toolConfigs` `load_skill`):
 *   loading → "Loading skill: X"  ·  loaded → "Loaded skill: X"
 *
 * @module react/components/chat/components/skill-tool
 */

import * as React from "react";
import { cn } from "../../theme.ts";
import { cva } from "../../ui/cva.ts";
import { Shimmer } from "../../ui/shimmer.tsx";
import { CheckIcon, SparklesIcon } from "../../icons/index.ts";

/** Row chrome — mirrors `ChatTool`: 14px text, soft, single-line. */
const skillToolRow = cva(
  "flex min-w-0 items-center gap-2 truncate text-sm text-[var(--foreground)]",
);

/** Props accepted by {@link SkillTool}. */
export interface SkillToolProps {
  /** The skill being loaded (id or filename). Renders in the row label. */
  skill: string;
  /**
   * Tool-call state.
   * - `loading` — Sparkles pulses, label shimmers.
   * - `loaded` — Check appears, label is solid.
   * @default "loaded"
   */
  state?: "loading" | "loaded";
  className?: string;
}

/** Render a skill-load tool-call row. */
export function SkillTool({
  skill,
  state = "loaded",
  className,
}: SkillToolProps): React.JSX.Element {
  const isLoading = state === "loading";
  const label = isLoading ? `Loading skill: ${skill}` : `Loaded skill: ${skill}`;

  return (
    <p className={cn(skillToolRow(), className)}>
      {isLoading
        ? <SparklesIcon className="size-3.5! shrink-0 animate-pulse" />
        : <CheckIcon className="size-3.5! shrink-0 text-[var(--success)]" />}
      {isLoading
        ? (
          <Shimmer as="span" duration={1} className="min-w-0 truncate">
            {label}
          </Shimmer>
        )
        : <span className="min-w-0 truncate">{label}</span>}
    </p>
  );
}
