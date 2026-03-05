/**
 * Theme System for Styled Components
 *
 * Provides default theme and utilities for customization.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export { cva, type VariantProps } from "class-variance-authority";

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
 * Default theme using Tailwind CSS - Clean, modern AI-assistant aesthetic
 */
export const defaultChatTheme: ChatTheme = {
  container: "flex flex-col h-full overflow-hidden bg-white dark:bg-neutral-950",
  message: {
    user:
      "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-[22px] px-5 py-3 max-w-[80%] shadow-sm",
    assistant: "text-neutral-800 dark:text-neutral-200 max-w-none",
    system: "text-neutral-500 dark:text-neutral-400 text-sm mx-auto text-center py-2",
    tool:
      "bg-neutral-50 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 rounded-xl px-3 py-2 text-sm font-mono border border-neutral-200 dark:border-neutral-800",
  },
  input:
    "flex-1 px-4 py-3 bg-transparent focus:outline-none dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 text-[15px] leading-normal",
  button:
    "size-9 shrink-0 mb-0.5 flex items-center justify-center rounded-full transition-all active:scale-95 bg-black text-white dark:bg-white dark:text-black disabled:bg-neutral-400 disabled:text-neutral-200 dark:disabled:bg-neutral-500 dark:disabled:text-neutral-300",
  loading: "size-2 bg-neutral-300 dark:bg-neutral-600 rounded-full animate-pulse",
};

export interface AgentTheme {
  /** Container styles */
  container?: string;

  /** Status styles */
  status?: string;

  /** Thinking indicator styles */
  thinking?: string;

  /** Tool invocation styles */
  tool?: string;

  /** Tool result styles */
  toolResult?: string;
}

/**
 * Default agent theme - Clean & minimal
 */
export const defaultAgentTheme: AgentTheme = {
  container:
    "border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 space-y-4 bg-white dark:bg-neutral-900",
  status: "inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium",
  thinking:
    "bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3 italic text-neutral-700 dark:text-neutral-300 border border-amber-200 dark:border-amber-800",
  tool:
    "rounded-xl px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800",
  toolResult:
    "mt-2 p-3 bg-neutral-100 dark:bg-neutral-800 rounded-xl font-mono text-sm overflow-x-auto",
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
 * Combines clsx (conditional classes) with tailwind-merge (deduplication).
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
        "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-[22px] px-5 py-3 max-w-[80%] shadow-sm",
      assistant: "text-neutral-800 dark:text-neutral-200 max-w-none",
      system: "text-neutral-500 dark:text-neutral-400 text-sm mx-auto text-center py-2",
      tool:
        "bg-neutral-50 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 rounded-xl px-3 py-2 text-sm font-mono border border-neutral-200 dark:border-neutral-800",
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
          "bg-black text-white dark:bg-white dark:text-black disabled:bg-neutral-400 disabled:text-neutral-200 dark:disabled:bg-neutral-500 dark:disabled:text-neutral-300",
        ghost:
          "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60",
        outline:
          "border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800",
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
      default: "h-full bg-white dark:bg-neutral-950",
      embedded: "h-full bg-transparent",
      floating:
        "h-[600px] w-[400px] rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-xl",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});
