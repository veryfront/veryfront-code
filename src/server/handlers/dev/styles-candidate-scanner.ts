/**
 * Styles Candidate Scanner
 *
 * Extracts Tailwind CSS candidate class names from project source files.
 * Supports two strategies: FS adapter with getAllSourceFiles() for remote/proxy
 * mode, and local filesystem scanning as fallback for local development.
 *
 * @module server/handlers/dev/styles-candidate-scanner
 */

import { extractCandidates } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { serverLogger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import type { HandlerContext } from "../types.ts";

const logger = serverLogger.component("styles-candidate-scanner");

const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];
const SKIP_DIRS = new Set(["node_modules", ".cache", ".git", "dist", "build", ".vscode"]);

/**
 * Tailwind classes used by framework React components (chat, agent-card, etc.).
 * These live inside the compiled binary and aren't in the user's project directory,
 * so the local file scanner can't discover them. Must be kept in sync with the
 * component source files in src/react/components/ai/ and src/react/primitives/.
 */
const FRAMEWORK_SAFELIST = [
  // ChatContainer / Chat layout (theme.ts defaultChatTheme + chat/index.tsx)
  "flex",
  "flex-col",
  "flex-1",
  "h-full",
  "h-screen",
  "min-h-0",
  "overflow-hidden",
  "overflow-y-auto",
  "relative",
  "bg-white",
  "dark:bg-neutral-900",
  "flex-shrink-0",
  "border-t",
  "border-neutral-200",
  "dark:border-neutral-800",
  "max-w-2xl",
  "mx-auto",
  "px-4",
  "py-3",
  "py-4",
  "gap-2",
  "items-center",
  "justify-center",
  "justify-end",
  "justify-start",
  "justify-between",
  "space-y-2",
  "text-center",
  // Message bubbles (theme.ts)
  "bg-blue-500",
  "text-white",
  "rounded-[20px]",
  "rounded-br-[4px]",
  "rounded-bl-[4px]",
  "px-4",
  "py-2.5",
  "max-w-[75%]",
  "bg-neutral-100",
  "dark:bg-neutral-800",
  "text-neutral-900",
  "dark:text-neutral-100",
  "text-neutral-500",
  "dark:text-neutral-400",
  "rounded-2xl",
  "text-sm",
  "bg-neutral-50",
  "text-neutral-600",
  "dark:text-neutral-300",
  "rounded-xl",
  "px-3",
  "py-2",
  "font-mono",
  "border",
  "border-neutral-200",
  "dark:border-neutral-700",
  // Input (theme.ts)
  "bg-neutral-100",
  "border-0",
  "rounded-full",
  "focus:outline-none",
  "focus:ring-2",
  "focus:ring-blue-500/30",
  "dark:text-neutral-100",
  "placeholder-neutral-400",
  "dark:placeholder-neutral-500",
  "text-[15px]",
  // Button (theme.ts)
  "w-9",
  "h-9",
  "bg-blue-500",
  "hover:bg-blue-600",
  "active:scale-95",
  "rounded-full",
  "transition-all",
  "disabled:opacity-30",
  "disabled:cursor-not-allowed",
  "disabled:hover:bg-blue-500",
  "disabled:active:scale-100",
  // Loading dots (theme.ts)
  "w-1.5",
  "h-1.5",
  "bg-neutral-400",
  "animate-bounce",
  // Empty state
  "text-3xl",
  "font-semibold",
  "mb-4",
  "mt-2",
  "max-w-md",
  "text-base",
  "text-muted-foreground",
  "text-foreground",
  // Icons
  "size-3",
  "size-3.5",
  "size-4",
  "size-10",
  "w-4",
  "h-4",
  "shrink-0",
  // Chat messages
  "whitespace-pre-wrap",
  "leading-relaxed",
  "my-3",
  // Loading animation
  "gap-1.5",
  "bg-neutral-100",
  // Error state
  "pb-2",
  "bg-red-50",
  "dark:bg-red-900/20",
  "text-red-600",
  "dark:text-red-400",
  "gap-3",
  "inline-flex",
  "px-3",
  "py-1.5",
  "text-xs",
  "font-medium",
  "bg-red-100",
  "dark:bg-red-900/40",
  "hover:bg-red-200",
  "dark:hover:bg-red-900/60",
  "transition-colors",
  // Tool UI
  "not-prose",
  "w-full",
  "rounded-md",
  "border-border",
  "bg-card",
  "p-3",
  "hover:bg-muted/50",
  "font-medium",
  "bg-muted/50",
  "text-secondary-foreground",
  "bg-secondary",
  "border-l-2",
  "border-muted",
  "pl-4",
  "ml-2",
  "uppercase",
  "tracking-wide",
  "overflow-x-auto",
  "bg-destructive/10",
  "text-destructive",
  // Suggestions
  "mt-6",
  "mb-8",
  "line-clamp-2",
  // Scroll button, reasoning, model selector
  "rotate-180",
  "transition-transform",
  "animate-pulse",
  "min-w-full",
  "text-left",
  "font-semibold",
  "text-neutral-700",
  "dark:text-neutral-300",
  // Agent card (theme.ts defaultAgentTheme)
  "p-6",
  "space-y-4",
  "bg-amber-50",
  "dark:bg-amber-900/20",
  "italic",
  "border-amber-200",
  "dark:border-amber-800",
  "bg-blue-50",
  "dark:bg-blue-900/20",
  "border-blue-200",
  "dark:border-blue-800",
  "mt-2",
  "overflow-x-auto",
  // MessageActions
  "gap-1",
  "mt-2",
  "hover:text-foreground",
  "hover:bg-muted",
  // Markdown
  "group",
] as const;

/** De-duplicated set of framework candidates, computed once. */
const frameworkCandidates = new Set<string>(FRAMEWORK_SAFELIST);

/**
 * Extract Tailwind CSS candidate class names from all project source files.
 *
 * Tries the FS adapter's `getAllSourceFiles()` first (available in proxy/remote
 * mode). Falls back to recursive local directory scanning when no adapter or
 * method is available (local dev mode).
 */
export async function extractProjectCandidates(ctx: HandlerContext): Promise<Set<string>> {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };

  if (typeof wrappedFs.getUnderlyingAdapter !== "function") {
    logger.debug(
      "[StylesCandidateScanner] No FS adapter wrapper, falling back to local file scanning",
    );
    return scanLocalFiles(ctx.projectDir, ctx);
  }

  // Call method directly on wrappedFs to preserve 'this' context
  const fsAdapter = wrappedFs.getUnderlyingAdapter() as {
    getAllSourceFiles?: () =>
      | Array<{ path: string; content?: string }>
      | Promise<Array<{ path: string; content?: string }>>;
  };

  if (typeof fsAdapter.getAllSourceFiles !== "function") {
    logger.debug(
      "[StylesCandidateScanner] FS adapter missing getAllSourceFiles, falling back to local file scanning",
    );
    return scanLocalFiles(ctx.projectDir, ctx);
  }

  const candidates = new Set<string>(frameworkCandidates);
  const files = await fsAdapter.getAllSourceFiles();

  for (const file of files) {
    if (!file.content) continue;
    if (!SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;

    for (const cls of extractCandidates(file.content)) {
      candidates.add(cls);
    }
  }

  return candidates;
}

/**
 * Fallback: scan local files for Tailwind candidates when no FS adapter is available.
 * Used in local development mode where projects are read directly from disk.
 */
async function scanLocalFiles(projectDir: string, ctx: HandlerContext): Promise<Set<string>> {
  const candidates = new Set<string>(frameworkCandidates);
  const fs = createFileSystem();

  const scanDir = async (dir: string): Promise<void> => {
    let entries: AsyncIterable<{ name: string; isDirectory: boolean; isFile: boolean }>;
    try {
      entries = fs.readDir(dir);
    } catch {
      return;
    }

    for await (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        if (!SKIP_DIRS.has(entry.name)) await scanDir(fullPath);
        continue;
      }

      if (!entry.isFile) continue;
      if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

      try {
        const content = await ctx.adapter.fs.readFile(fullPath);
        for (const cls of extractCandidates(content)) candidates.add(cls);
      } catch {
        // Skip files that can't be read
      }
    }
  };

  try {
    await scanDir(projectDir);
    logger.debug("Local file scan complete", {
      projectDir,
      candidates: candidates.size,
    });
  } catch (error) {
    logger.warn("Failed to scan local files", {
      projectDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return candidates;
}
