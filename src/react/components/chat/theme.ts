/**
 * Theme System for Styled Components
 *
 * Uses CSS custom properties that align with the Veryfront Studio design system.
 * When embedded in a host that defines --background, --foreground, etc., the chat
 * UI automatically inherits those tokens. When standalone, sensible defaults are
 * injected via <style> on the chat root element.
 */

import { type ClassValue, clsx } from "#veryfront/utils/clsx.ts";

// ---------------------------------------------------------------------------
// CSS Custom Property tokens
// ---------------------------------------------------------------------------

/**
 * Light-mode defaults copied from Veryfront Studio `styles/styles.css`.
 * Keep these values aligned with Studio so standalone chat renders with the
 * same surface, edge, and text hierarchy before a host app provides tokens.
 */
const TOKENS_LIGHT = {
  "--background": "#F0EFE9",
  "--foreground": "#010101",
  "--primary": "#282828",
  "--secondary": "#FFFFFF",
  "--tertiary": "#F0EFE9",
  "--accent": "#E8E6DB",
  "--muted": "#F7F6F4",
  "--destructive": "#D40C1A",
  "--outline-border": "#DCDAD0",
  "--status-neutral": "#9F9F9F",
  "--status-info": "#0071DF",
  "--status-success": "#098926",
  "--status-warning": "#F99100",
  "--status-error": "#D40924",
  "--alert-warning-bg": "#F1E3CD",
  "--alert-error-bg": "#ECD3D1",
  "--alert-success-bg": "#D4E2D2",
  "--alert-info-bg": "#E6E6E0",
  "--faint": "oklch(from var(--foreground) l c h / 0.25)",
  "--soft": "oklch(from var(--foreground) l c h / 0.7)",
  "--tint": "oklch(from var(--foreground) l c h / 0.04)",
  "--edge": "oklch(from var(--foreground) l c h / 0.06)",
  "--edge-medium": "oklch(from var(--foreground) l c h / 0.1)",
  "--separator": "#EEEEED",
  "--shadow-sm": "0 1.5px 3px rgba(0, 0, 0, 0.08)",
  "--code-bg": "var(--secondary)",
  "--input-bg": "var(--secondary)",
  "--popover": "var(--secondary)",
  "--dialog": "var(--background)",
  "--drawer": "var(--background)",
  "--overlay": "rgba(0, 0, 0, 0.5)",
  "--card": "var(--secondary)",
  "--card-foreground": "var(--foreground)",
  "--popover-foreground": "var(--foreground)",
  "--primary-foreground": "var(--secondary)",
  "--muted-foreground": "var(--faint)",
  "--accent-foreground": "var(--foreground)",
  "--destructive-foreground": "#FFFFFF",
  "--border": "var(--outline-border)",
  "--input": "var(--input-bg)",
  "--input-border": "var(--edge-medium)",
  "--input-placeholder": "var(--faint)",
  "--ring": "var(--edge-medium)",
  "--success": "var(--status-success)",
  "--chat-bubble": "var(--primary)",
  "--chat-bubble-foreground": "var(--secondary)",
  "--tab-background": "var(--secondary)",
  "--tab-foreground": "var(--faint)",
  "--tab-active-background": "var(--accent)",
  "--tab-active-foreground": "var(--foreground)",
  "--sidebar-background": "var(--background)",
  "--sidebar-foreground": "var(--foreground)",
  "--sidebar-border": "var(--edge-medium)",
  "--radius-xs": "4px",
  "--radius-sm": "8px",
  "--radius-md": "12px",
  "--radius-lg": "20px",
  "--radius-xl": "35px",
  "--font-weight-normal": "400",
  "--font-weight-medium": "500",
} as const;

/**
 * Dark-mode defaults copied from Studio `[data-theme="dark"]`.
 */
const TOKENS_DARK = {
  ...TOKENS_LIGHT,
  "--background": "#282828",
  "--foreground": "#F0EFE9",
  "--primary": "#F1F0EA",
  "--secondary": "#333333",
  "--tertiary": "#262626",
  "--accent": "#303030",
  "--muted": "#0D1315",
  "--outline-border": "#3A3A3A",
  "--separator": "oklch(from var(--foreground) l c h / 0.06)",
  "--code-bg": "oklch(0.08 0.005 280)",
  "--input-bg": "#40403F",
  "--primary-foreground": "var(--secondary)",
  "--chat-bubble": "var(--primary)",
  "--chat-bubble-foreground": "var(--secondary)",
} as const;

function tokensToCSS(tokens: Record<string, string>): string {
  return Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(";");
}

/**
 * Generates scoped CSS for the chat UI design tokens.
 * Uses [data-vf-chat] as scope so tokens don't leak to the page.
 *
 * If a host application (e.g. Studio) already defines these CSS custom
 * properties on :root, the host values cascade through and our fallbacks
 * are never reached — because we set them on [data-vf-chat] which has
 * lower specificity for inherited vars. We intentionally only set them
 * on the chat root so parent-defined tokens take precedence.
 *
 * Dark mode: supports prefers-color-scheme, .dark, and [data-theme="dark"].
 */
/**
 * Animation CSS for the chat UI primitives (Spinner, Shimmer, ProgressBar,
 * LoadingButton). Copied from Studio `styles/animations.css`. Since
 * `veryfront/chat` ships as a self-contained npm package, it carries both the
 * `@keyframes` AND the named `animate-*` utility classes itself — components
 * use Studio's clean class names (`animate-bounce-spin`) without requiring the
 * consumer's Tailwind to register them. `shimmer-sweep` stays an arbitrary
 * `animate-[…]` utility (its duration is set inline), so only its keyframes are
 * needed here. Keep in sync with `storybook/.storybook/preview.css`.
 */
const ANIMATION_CSS =
  "@keyframes bounce-spin{0%,100%{transform:translateY(0) rotate(0deg);animation-timing-function:ease-in-out}25%{transform:translateY(-30%) rotate(90deg);animation-timing-function:ease-in}50%{transform:translateY(0) rotate(180deg);animation-timing-function:ease-out}75%{transform:translateY(-15%) rotate(270deg);animation-timing-function:ease-in}}" +
  "@keyframes button-loading{0%,100%{opacity:1}50%{opacity:.55}}" +
  "@keyframes shimmer-sweep{0%{background-position:100% center}100%{background-position:0% center}}" +
  "@keyframes progress-indeterminate{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}" +
  ".animate-bounce-spin{animation:bounce-spin 2.5s cubic-bezier(0.25,1,0.5,1) infinite}" +
  ".animate-button-loading{animation:button-loading 1.4s cubic-bezier(0.4,0,0.2,1) infinite}" +
  ".animate-progress-indeterminate{animation:progress-indeterminate 1.2s ease-in-out infinite}";

export function generateTokenCSS(): string {
  const light = tokensToCSS(TOKENS_LIGHT);
  const dark = tokensToCSS(TOKENS_DARK);

  // The design tokens stay scoped to `[data-vf-chat]`, never `:root`: the
  // names (`--primary`, `--background`, `--accent`, …) are the same generic
  // convention host apps use for their own themes, and these style tags render
  // in the body — after a host's <head> stylesheets — so a `:root` rule here
  // would override the host's tokens page-wide (and the dark media query would
  // repaint light-only host pages for OS-dark users). Surfaces that render
  // *outside* `<Chat>` (`<ChatSidebar>`, `<AttachmentsPanel>`, `<AppShell>`)
  // establish their own `data-vf-chat` scope and inject `<ChatTokens>`;
  // portalled content re-anchors via `closest("[data-vf-chat]")`.
  return [
    `[data-vf-chat]{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-weight:var(--font-weight-normal);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;${light}}`,
    `[data-vf-chat] button{cursor:pointer;}`,
    `@media(prefers-color-scheme:dark){[data-vf-chat]:not([data-vf-theme]){${dark}}}`,
    `.dark [data-vf-chat]:not([data-vf-theme]),[data-theme="dark"] [data-vf-chat]:not([data-vf-theme]),.dark[data-vf-chat]:not([data-vf-theme]),[data-theme="dark"][data-vf-chat]:not([data-vf-theme]){${dark}}`,
    ANIMATION_CSS,
  ].join("");
}

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
