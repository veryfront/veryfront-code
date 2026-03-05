/**
 * Theme System for Styled Components
 *
 * Uses CSS custom properties that align with the Veryfront Studio design system.
 * When embedded in a host that defines --background, --foreground, etc., the chat
 * UI automatically inherits those tokens. When standalone, sensible defaults are
 * injected via <style> on the chat root element.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export { cva, type VariantProps } from "class-variance-authority";

// ---------------------------------------------------------------------------
// CSS Custom Property tokens
// ---------------------------------------------------------------------------

/**
 * Light-mode defaults that match the Veryfront Studio `:root` values.
 * Uses OKLch for perceptual uniformity.
 */
export const TOKENS_LIGHT = {
  "--background": "oklch(0.9512 0.008 98.88)",
  "--foreground": "oklch(0.2768 0 0)",
  "--card": "oklch(1 0 0)",
  "--card-foreground": "oklch(0.2768 0 0)",
  "--popover": "oklch(1 0 0)",
  "--popover-foreground": "oklch(0.2768 0 0)",
  "--primary": "oklch(0.2768 0 0)",
  "--primary-foreground": "oklch(1 0 0)",
  "--muted": "oklch(0.9422 0.0081 98.88)",
  "--muted-foreground": "oklch(0.55 0.005 95.11)",
  "--accent": "oklch(0.93 0 0)",
  "--accent-foreground": "oklch(0.15 0 0)",
  "--destructive": "oklch(0.55 0.22 27)",
  "--destructive-foreground": "oklch(1 0 0)",
  "--border": "oklch(0.84 0.0055 95.11)",
  "--input": "oklch(1 0 0)",
  "--input-border": "oklch(0.88 0 0)",
  "--input-placeholder": "oklch(0.7025 0 0)",
  "--ring": "oklch(0.2768 0 0 / 0.3)",
  "--success": "oklch(0.52 0.15 145)",
  "--chat-bubble": "oklch(0.2768 0 0)",
  "--chat-bubble-foreground": "oklch(1 0 0)",
  "--tab-background": "oklch(1 0 0)",
  "--tab-foreground": "oklch(0.7025 0 0)",
  "--tab-active-background": "oklch(0.9422 0.0081 98.88)",
  "--tab-active-foreground": "oklch(0.2768 0 0)",
  "--sidebar-background": "oklch(0.97 0 0)",
  "--sidebar-foreground": "oklch(0.07 0 0)",
  "--sidebar-border": "oklch(0.9 0 0)",
} as const;

/**
 * Dark-mode defaults that match the Studio `[data-theme="dark"]` values.
 */
export const TOKENS_DARK = {
  "--background": "oklch(0.2768 0 0)",
  "--foreground": "oklch(0.9512 0.008 98.88)",
  "--card": "oklch(0.3211 0 0)",
  "--card-foreground": "oklch(0.9512 0.008 98.88)",
  "--popover": "oklch(0.21 0.01 220)",
  "--popover-foreground": "oklch(0.9512 0.008 98.88)",
  "--primary": "oklch(0.9512 0.008 98.88)",
  "--primary-foreground": "oklch(0.2768 0 0)",
  "--muted": "oklch(0.5338 0.0046 106.55)",
  "--muted-foreground": "oklch(0.9512 0.008 98.88)",
  "--accent": "oklch(0.25 0.01 220)",
  "--accent-foreground": "oklch(1 0 0)",
  "--destructive": "oklch(0.55 0.22 27)",
  "--destructive-foreground": "oklch(1 0 0)",
  "--border": "oklch(0.42 0.0017 106.48)",
  "--input": "oklch(0.3211 0 0)",
  "--input-border": "oklch(0.38 0.01 220)",
  "--input-placeholder": "oklch(0.8975 0 0)",
  "--ring": "oklch(0.6 0.01 220 / 0.5)",
  "--success": "oklch(0.52 0.14 143)",
  "--chat-bubble": "oklch(0.9512 0.008 98.88)",
  "--chat-bubble-foreground": "oklch(0.2768 0 0)",
  "--tab-background": "oklch(0.3211 0 0)",
  "--tab-foreground": "oklch(0.8975 0 0)",
  "--tab-active-background": "oklch(0.5338 0.0046 106.55)",
  "--tab-active-foreground": "oklch(0.9512 0.008 98.88)",
  "--sidebar-background": "oklch(0.18 0.01 220)",
  "--sidebar-foreground": "oklch(0.9512 0.008 98.88)",
  "--sidebar-border": "oklch(0.3 0.01 220)",
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
export function generateTokenCSS(): string {
  const light = tokensToCSS(TOKENS_LIGHT);
  const dark = tokensToCSS(TOKENS_DARK);

  return [
    `[data-vf-chat]{${light}}`,
    `@media(prefers-color-scheme:dark){[data-vf-chat]:not([data-vf-theme]){${dark}}}`,
    `.dark [data-vf-chat]:not([data-vf-theme]),[data-theme="dark"] [data-vf-chat]:not([data-vf-theme]){${dark}}`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Theme interfaces
// ---------------------------------------------------------------------------

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
  container: "flex flex-col h-full overflow-hidden bg-[var(--background)]",
  message: {
    user:
      "bg-[var(--chat-bubble)] text-[var(--chat-bubble-foreground)] rounded-[22px] px-5 py-3 max-w-[80%] shadow-sm",
    assistant: "text-[var(--card-foreground)] max-w-none",
    system: "text-[var(--muted-foreground)] text-sm mx-auto text-center py-2",
    tool:
      "bg-[var(--card)] text-[var(--card-foreground)] rounded-xl px-3 py-2 text-sm font-mono border border-[var(--border)]",
  },
  input:
    "flex-1 px-4 py-3 bg-transparent focus:outline-none text-[var(--foreground)] placeholder:text-[var(--input-placeholder)] text-[15px] leading-normal",
  button:
    "size-9 shrink-0 mb-0.5 flex items-center justify-center rounded-full transition-all active:scale-95 bg-[var(--primary)] text-[var(--primary-foreground)] disabled:opacity-40",
  loading: "size-2 bg-[var(--border)] rounded-full animate-pulse",
};

export interface AgentTheme {
  container?: string;
  status?: string;
  thinking?: string;
  tool?: string;
  toolResult?: string;
}

export const defaultAgentTheme: AgentTheme = {
  container:
    "border border-[var(--border)] rounded-2xl p-6 space-y-4 bg-[var(--card)]",
  status: "inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium",
  thinking:
    "bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3 italic text-[var(--foreground)] border border-amber-200 dark:border-amber-800",
  tool:
    "rounded-xl px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800",
  toolResult:
    "mt-2 p-3 bg-[var(--accent)] rounded-xl font-mono text-sm overflow-x-auto",
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
 * Utility to combine and merge Tailwind class names.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// CVA Variant Definitions
// ---------------------------------------------------------------------------

import { cva } from "class-variance-authority";

export const messageVariants = cva("", {
  variants: {
    role: {
      user:
        "bg-[var(--chat-bubble)] text-[var(--chat-bubble-foreground)] rounded-[22px] px-5 py-3 max-w-[80%] shadow-sm",
      assistant: "text-[var(--card-foreground)] max-w-none",
      system: "text-[var(--muted-foreground)] text-sm mx-auto text-center py-2",
      tool:
        "bg-[var(--card)] text-[var(--card-foreground)] rounded-xl px-3 py-2 text-sm font-mono border border-[var(--border)]",
    },
  },
  defaultVariants: {
    role: "assistant",
  },
});

export const chatButtonVariants = cva(
  "shrink-0 flex items-center justify-center rounded-full transition-all active:scale-95",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--primary)] text-[var(--primary-foreground)] disabled:opacity-40",
        ghost:
          "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)]",
        outline:
          "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--accent)]",
      },
      size: {
        sm: "size-7",
        md: "size-8",
        lg: "size-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "lg",
    },
  },
);

export const chatContainerVariants = cva("flex flex-col overflow-hidden", {
  variants: {
    variant: {
      default: "h-full bg-[var(--background)]",
      embedded: "h-full bg-transparent",
      floating:
        "h-[600px] w-[400px] rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-xl",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});
