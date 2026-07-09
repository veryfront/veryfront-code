/**
 * Theme System for Styled Components
 *
 * Uses CSS custom properties that align with the Veryfront Studio design system.
 * When embedded in a host that defines --background, --foreground, etc., the chat
 * UI automatically inherits those tokens. When standalone, sensible defaults are
 * injected via <style> on the chat root element.
 */

import { type ClassValue, clsx } from "#veryfront/utils/clsx.ts";

// The design-token vocabulary now lives in the base `veryfront/ui` layer;
// chat renders against the same tokens, so re-export the generator here to
// keep `theme.ts`'s existing API (`generateTokenCSS`) stable for chat callers.
export { generateTokenCSS } from "../ui/design-tokens.ts";

// ---------------------------------------------------------------------------
// Theme interfaces
// ---------------------------------------------------------------------------

/** Public API contract for chat theme. */
export interface ChatTheme {
  /** Container styles */
  container?: string;
  /** Message styles by role */
  message?: {
    user?: string;
    assistant?: string;
    system?: string;
    tool?: string;
  };
  /** Input styles */
  input?: string;
  /** Button styles */
  button?: string;
  /** Loading indicator styles */
  loading?: string;
}

/**
 * Default theme using CSS custom properties from the design system.
 */
export const defaultChatTheme: ChatTheme = {
  container: "flex flex-col h-full overflow-hidden bg-[var(--background)] text-[var(--foreground)]",
  message: {
    // Plain right-aligned user turn (no bubble) — the Root handles alignment +
    // max-width. A consumer can opt into a bubble via `theme.message.user`.
    user: "text-[15px] leading-relaxed text-[var(--foreground)]",
    assistant: "max-w-none text-[var(--foreground)] [overflow-wrap:anywhere]",
    system: "text-[var(--faint)] text-sm mx-auto text-center py-2",
    tool:
      "rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent px-4 py-3 text-sm font-mono text-[var(--foreground)]",
  },
  input:
    "w-full bg-transparent border-none text-[15px] leading-6 text-[var(--foreground)] placeholder:text-[var(--faint)] focus:outline-none focus:ring-0",
  button:
    "flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--secondary)] transition-[background-color,color] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
  loading: "size-2 bg-[var(--edge-medium)] rounded-full animate-pulse",
};

/** Public API contract for agent theme. */
export interface AgentTheme {
  container?: string;
  status?: string;
  thinking?: string;
  tool?: string;
  toolResult?: string;
}

export const defaultAgentTheme: AgentTheme = {
  container:
    "space-y-4 rounded-[var(--radius-lg)] bg-[var(--secondary)] p-5 text-[var(--foreground)]",
  status: "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
  thinking:
    "rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent px-4 py-3 text-sm text-[var(--foreground)]",
  tool: "rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent px-4 py-3",
  toolResult:
    "mt-2 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--tertiary)] p-3 font-mono text-xs",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Merge themes (user theme overrides default)
 */
export function mergeThemes<T>(
  defaultTheme: T,
  userTheme?: Partial<T>,
): T {
  if (!userTheme) return defaultTheme;

  const merged = { ...defaultTheme };
  const defaultObj = defaultTheme as Record<string, unknown>;
  const userObj = userTheme as Record<string, unknown>;

  for (const key in userObj) {
    const value = userObj[key];
    if (value === undefined) continue;

    const defaultValue = defaultObj[key];

    if (isPlainObject(value) && isPlainObject(defaultValue)) {
      (merged as Record<string, unknown>)[key] = { ...defaultValue, ...value };
      continue;
    }

    (merged as Record<string, unknown>)[key] = value;
  }

  return merged;
}

/**
 * Utility to combine class names.
 *
 * NOTE: this is `clsx` only — it does NOT tailwind-merge. A `className` passed by
 * a consumer is *appended*, not deduped, so it does not automatically beat a base
 * utility of the same property (both end up in the class list, last-wins by
 * CSS-source order, which is usually the base). To override a base utility from
 * userland, use the `!` important suffix — e.g. `px-8!`, `rounded-xl!`, `size-6!`.
 * Every cva-based primitive (Button, Card, Input, Textarea, Badge, Pill, Select,
 * Tabs) inherits this behaviour.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

type VariantMap = Record<string, Record<string, ClassValue>>;

type VariantOptions<TVariants extends VariantMap> =
  & {
    [TKey in keyof TVariants]?: keyof TVariants[TKey] | null | undefined;
  }
  & {
    class?: ClassValue;
    className?: ClassValue;
  };

type VariantClassFunction<TVariants extends VariantMap> = (
  options?: VariantOptions<TVariants>,
) => string;

function variantClasses<TVariants extends VariantMap>(
  base: ClassValue,
  config: {
    variants: TVariants;
    defaultVariants?: Partial<
      {
        [TKey in keyof TVariants]: keyof TVariants[TKey] | null | undefined;
      }
    >;
  },
): VariantClassFunction<TVariants> {
  return (options = {}) => {
    const classes: ClassValue[] = [base];

    for (
      const [variantName, variantValues] of Object.entries(config.variants)
    ) {
      const option = options[variantName];
      const selected = Object.hasOwn(options, variantName) && option !== undefined
        ? option
        : config.defaultVariants?.[variantName];
      if (selected === null || selected === undefined) continue;
      classes.push(variantValues[String(selected)]);
    }

    classes.push(options.class, options.className);
    return cn(classes);
  };
}

export const messageVariants = variantClasses("", {
  variants: {
    role: {
      user:
        "max-w-[80%] rounded-[var(--radius-lg)] bg-[var(--chat-bubble)] px-4 py-3 text-base leading-relaxed text-[var(--chat-bubble-foreground)] shadow-sm",
      assistant: "max-w-none text-[var(--foreground)] [overflow-wrap:anywhere]",
      system: "text-[var(--faint)] text-sm mx-auto text-center py-2",
      tool:
        "rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-transparent px-4 py-3 text-sm font-mono text-[var(--foreground)]",
    },
  },
  defaultVariants: {
    role: "assistant",
  },
});

export const chatButtonVariants = variantClasses(
  [
    "relative",
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-normal rounded-full transition-[background-color,color,border-color] duration-150 ease-in",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
    "disabled:pointer-events-none",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--primary)] text-[var(--secondary)] shadow-sm hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
        ghost: "bg-transparent text-[var(--foreground)] hover:bg-[var(--accent)]",
        outline:
          "border border-[var(--outline-border)] bg-transparent text-[var(--foreground)] hover:border-transparent hover:bg-[var(--accent)]",
        "icon-ghost":
          "bg-transparent text-[var(--foreground)] hover:bg-[var(--accent)] !p-0 !gap-0",
      },
      size: {
        sm: "h-[32px] px-3.5 text-sm [&_svg]:size-4",
        default: "h-[38px] px-[1.125rem] text-base [&_svg]:size-4",
        "icon-xs": "size-7 [&_svg]:size-4",
        "icon-sm": "size-7 [&_svg]:size-4",
        "icon-default": "size-8 [&_svg]:size-[1.125rem]",
        "icon-lg": "size-9 [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export const chatContainerVariants = variantClasses(
  "flex flex-col overflow-hidden",
  {
    variants: {
      variant: {
        default: "h-full bg-[var(--background)]",
        embedded: "h-full bg-transparent",
        floating:
          "h-[600px] w-[400px] rounded-[var(--radius-lg)] border border-[var(--outline-border)] bg-[var(--background)] shadow-sm",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
