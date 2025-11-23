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
 * Default theme using Tailwind CSS
 */
export const defaultChatTheme: ChatTheme = {
  container: "flex flex-col h-full bg-white dark:bg-gray-950",
  message: {
    user: "bg-blue-600 text-white rounded-lg px-4 py-2 max-w-[70%] ml-auto",
    assistant:
      "bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-4 py-2 max-w-[70%]",
    system:
      "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-100 rounded px-3 py-1 text-sm",
    tool:
      "bg-purple-100 dark:bg-purple-900/20 text-purple-900 dark:text-purple-100 rounded px-3 py-1 text-sm font-mono",
  },
  input:
    "flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100",
  button:
    "px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
  loading: "w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin",
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
