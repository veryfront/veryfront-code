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
  // Layout & display
  "absolute",
  "block",
  "bottom-full",
  "fixed",
  "flex",
  "flex-1",
  "flex-col",
  "flex-shrink-0",
  "flex-wrap",
  "grid",
  "grid-cols-3",
  "h-full",
  "h-px",
  "hidden",
  "inline-block",
  "inline-flex",
  "inset-0",
  "items-center",
  "items-end",
  "items-start",
  "justify-between",
  "justify-center",
  "justify-end",
  "justify-start",
  "min-h-0",
  "min-w-0",
  "not-prose",
  "overflow-auto",
  "overflow-hidden",
  "overflow-x-auto",
  "overflow-y-auto",
  "pointer-events-none",
  "relative",
  "shrink-0",
  "w-full",
  // Spacing
  "gap-0.5",
  "gap-1",
  "gap-1.5",
  "gap-2",
  "gap-2.5",
  "gap-3",
  "gap-4",
  "mb-0.5",
  "mb-1",
  "mb-2",
  "mb-3",
  "mb-4",
  "mb-6",
  "mt-0.5",
  "mt-1",
  "mt-2",
  "mt-2.5",
  "mt-3",
  "mt-4",
  "mt-6",
  "mx-auto",
  "mx-0.5",
  "my-2",
  "my-3",
  "my-4",
  "p-0.5",
  "p-1",
  "p-1.5",
  "p-2",
  "p-2.5",
  "p-3",
  "p-4",
  "p-6",
  "pb-2",
  "pb-6",
  "pl-2",
  "pl-3",
  "pl-4",
  "pr-1.5",
  "pt-2",
  "pt-3",
  "px-1",
  "px-1.5",
  "px-2",
  "px-2.5",
  "px-3",
  "px-4",
  "px-5",
  "py-0.5",
  "py-1",
  "py-1.5",
  "py-2",
  "py-2.5",
  "py-3",
  "py-4",
  "py-6",
  "space-y-2",
  "space-y-4",
  // Sizing
  "h-[34px]",
  "h-[38px]",
  "h-[42px]",
  "h-[600px]",
  "h-1",
  "h-1.5",
  "h-2",
  "h-3",
  "h-3.5",
  "h-4",
  "h-5",
  "h-7",
  "h-8",
  "h-9",
  "h-10",
  "h-14",
  "h-32",
  "max-h-[320px]",
  "max-w-[80%]",
  "max-w-[160px]",
  "max-w-[220px]",
  "max-w-2xl",
  "max-w-md",
  "max-w-none",
  "min-h-[88px]",
  "min-w-[2ch]",
  "min-w-full",
  "size-1",
  "size-1.5",
  "size-2",
  "size-2.5",
  "size-3",
  "size-3.5",
  "size-4",
  "size-5",
  "size-7",
  "size-8",
  "size-9",
  "size-10",
  "size-14",
  "w-[400px]",
  "w-4",
  "w-9",
  "w-64",
  "w-80",
  // Typography
  "capitalize",
  "font-bold",
  "font-medium",
  "font-mono",
  "font-semibold",
  "leading-7",
  "leading-none",
  "leading-normal",
  "leading-relaxed",
  "leading-snug",
  "line-clamp-1",
  "line-clamp-2",
  "line-clamp-3",
  "line-clamp-4",
  "text-[10px]",
  "text-[13px]",
  "text-[15px]",
  "text-[9px]",
  "text-3xl",
  "text-base",
  "text-center",
  "text-left",
  "text-right",
  "text-sm",
  "text-xs",
  "tracking-tight",
  "tracking-wide",
  "tracking-wider",
  "truncate",
  "uppercase",
  "whitespace-nowrap",
  "whitespace-pre-wrap",
  // CSS custom property colors (bg)
  "bg-[var(--accent)]",
  "bg-[var(--background)]",
  "bg-[var(--border)]",
  "bg-[var(--card)]",
  "bg-[var(--destructive)]",
  "bg-[var(--destructive)]/5",
  "bg-[var(--destructive)]/10",
  "bg-[var(--foreground)]",
  "bg-[var(--foreground)]/5",
  "bg-[var(--primary)]",
  "bg-[var(--sidebar-background)]",
  "bg-[var(--tab-active-background)]",
  "bg-[var(--tab-background)]",
  "bg-transparent",
  // CSS custom property colors (text)
  "text-[var(--background)]",
  "text-[var(--card-foreground)]",
  "text-[var(--destructive)]",
  "text-[var(--destructive-foreground)]",
  "text-[var(--foreground)]",
  "text-[var(--input-placeholder)]",
  "text-[var(--muted-foreground)]",
  "text-[var(--primary-foreground)]",
  "text-[var(--success)]",
  "text-[var(--tab-active-foreground)]",
  "text-[var(--tab-foreground)]",
  // CSS custom property borders
  "border-[var(--border)]",
  "border-[var(--destructive)]/20",
  "border-[var(--input-border)]",
  "border-[var(--sidebar-border)]",
  "border-[var(--success)]",
  // Semantic/accent colors
  "bg-amber-500/10",
  "bg-blue-500/10",
  "bg-emerald-500/10",
  "bg-gradient-to-br",
  "bg-green-500",
  "bg-neutral-500/10",
  "bg-purple-500/10",
  "bg-red-500/10",
  "border-amber-500/20",
  "border-blue-500/20",
  "from-violet-500",
  "text-amber-500",
  "text-amber-600",
  "text-blue-500",
  "text-blue-600",
  "text-emerald-500",
  "text-green-500",
  "text-green-600",
  "text-purple-600",
  "text-red-500",
  "text-red-600",
  "text-white",
  "text-yellow-600",
  "to-fuchsia-500",
  // Model avatars
  "bg-[#d97757]",
  // Borders
  "border",
  "border-2",
  "border-b",
  "border-b-2",
  "border-dashed",
  "border-l",
  "border-l-2",
  "border-l-4",
  "border-r",
  "border-t",
  "rounded",
  "rounded-[22px]",
  "rounded-2xl",
  "rounded-full",
  "rounded-lg",
  "rounded-t-xl",
  "rounded-xl",
  // Interactive states
  "active:scale-95",
  "cursor-default",
  "cursor-not-allowed",
  "cursor-pointer",
  "disabled:opacity-40",
  "disabled:opacity-50",
  "disabled:pointer-events-none",
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-[var(--ring)]",
  "focus-visible:ring-offset-2",
  "focus:outline-none",
  "group",
  "group/msg",
  "group/thread",
  "group-hover:opacity-100",
  "group-hover:text-[var(--foreground)]",
  "group-hover/msg:opacity-100",
  "group-hover/thread:opacity-100",
  "hover:bg-[var(--accent)]",
  "hover:bg-[var(--foreground)]/5",
  "hover:border-[var(--input-border)]",
  "hover:opacity-90",
  "hover:shadow-sm",
  "hover:text-[var(--destructive)]",
  "hover:text-[var(--foreground)]",
  "hover:underline",
  // Animation & transitions
  "animate-bounce",
  "animate-in",
  "animate-pulse",
  "duration-150",
  "duration-200",
  "duration-500",
  "fade-in",
  "rotate-180",
  "transition-all",
  "transition-colors",
  "transition-transform",
  "transition-[left,width]",
  // Positioning
  "bottom-1",
  "bottom-4",
  "left-0",
  "left-1/2",
  "top-1",
  "z-10",
  "z-20",
  "z-50",
  "-translate-x-1/2",
  "-translate-y-0.5",
  "translate-y-0.5",
  // Visibility & opacity
  "opacity-0",
  "opacity-40",
  "opacity-50",
  "opacity-60",
  "opacity-70",
  "opacity-75",
  "opacity-90",
  // Shadows & effects
  "backdrop-blur-sm",
  "shadow-lg",
  "shadow-sm",
  "shadow-xl",
  // Prose / markdown
  "prose",
  "prose-sm",
  // Responsive
  "max-sm:absolute",
  "max-sm:shadow-xl",
  "max-sm:z-20",
  // Misc
  "italic",
  "order-1",
  "order-2",
  "select-all",
  "tabular-nums",
  // Agent card (theme.ts defaultAgentTheme)
  "bg-amber-500/10",
  "border-amber-500/20",
  "bg-blue-500/10",
  "border-blue-500/20",
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
