/**
 * Theme System for Styled Components
 *
 * Provides default theme and utilities for customization.
 */

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
 * Default theme using Tailwind CSS - Apple Messages inspired, clean & minimal
 */
export const defaultChatTheme: ChatTheme = {
  container: "flex flex-col h-full bg-white dark:bg-neutral-900",
  message: {
    user: "bg-blue-500 text-white rounded-[20px] rounded-br-[4px] px-4 py-2.5 max-w-[75%]",
    assistant:
      "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-[20px] rounded-bl-[4px] px-4 py-2.5 max-w-[75%]",
    system:
      "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 rounded-2xl px-4 py-2 text-sm mx-auto text-center",
    tool:
      "bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 rounded-xl px-3 py-2 text-sm font-mono border border-neutral-200 dark:border-neutral-700",
  },
  input:
    "flex-1 px-4 py-2.5 bg-neutral-100 dark:bg-neutral-800 border-0 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 text-[15px]",
  button:
    "w-9 h-9 flex items-center justify-center bg-blue-500 hover:bg-blue-600 active:scale-95 text-white rounded-full transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-blue-500 disabled:active:scale-100",
  loading: "w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce",
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
 * Default agent theme
 */
export const defaultAgentTheme: AgentTheme = {
  container:
    "border border-gray-200 dark:border-gray-800 rounded-lg p-6 space-y-4 bg-white dark:bg-gray-950",
  status: "inline-flex items-center px-3 py-1 rounded-full text-sm font-medium",
  thinking:
    "bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500 pl-4 py-2 italic text-gray-700 dark:text-gray-300",
  tool: "border-l-4 border-blue-500 pl-4 py-2 bg-blue-50 dark:bg-blue-900/20",
  toolResult: "mt-2 p-3 bg-gray-100 dark:bg-gray-900 rounded font-mono text-sm overflow-x-auto",
};

/**
 * Merge themes (user theme overrides default)
 */
export function mergeThemes<T extends Record<string, any>>(
  defaultTheme: T,
  userTheme?: Partial<T>,
): T {
  if (!userTheme) return defaultTheme;

  const merged = { ...defaultTheme };

  for (const key in userTheme) {
    const value = userTheme[key];

    if (value === undefined) {
      continue;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      // Merge nested objects
      merged[key] = { ...defaultTheme[key], ...value } as T[Extract<keyof T, string>];
    } else {
      merged[key] = value as T[Extract<keyof T, string>];
    }
  }

  return merged;
}

/**
 * Utility to combine class names
 * (Simple version - in production use 'clsx' or 'cn' from shadcn)
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}
