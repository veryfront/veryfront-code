/**
 * CodeBlock — the "ace" syntax-highlighted code primitive, forked
 * dependency-light from Veryfront Studio's `ChatCodeBlock`. Structurally 1:1
 * (shiki highlight + copy + language label + collapsible + mermaid), but:
 *
 * - **Themes:** shiki built-in `github-light` / `github-dark`, switched on our
 *   `useColorMode` — NOT Studio's `veryfrontDarkTheme`.
 * - **Dependency-light:** shiki and mermaid are lazy-loaded from esm.sh on first
 *   render (same pattern as `markdown.tsx`), never bundled. A `Skeleton` shows
 *   while the highlighter loads; a plain `<pre>` is the graceful fallback.
 * - **Stripped (Studio-panel only):** `openTab`/`openPanel`/`openFilePath`/
 *   `executeCommand`, file previews, the actions dropdown, radix
 *   `useControllableState`, and `printReadiness`.
 *
 * Private to the chat module.
 *
 * @module react/components/ui/code-block
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "./icons/index.ts";
import { useColorModeOptional } from "./color-mode.tsx";

/** Light/dark, for switching the shiki + mermaid theme. */
type CodeBlockMode = "light" | "dark";
import { Skeleton } from "./skeleton.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx";
import { IconButton } from "./icon-button.tsx";

// ---------------------------------------------------------------------------
// Lazy esm.sh loaders (dependency-light — mirrors markdown.tsx)
// ---------------------------------------------------------------------------

const ESM_SHIKI = "https://esm.sh/shiki@1.24.0?target=es2022&pin=v135";
const ESM_MERMAID = "https://esm.sh/mermaid@11.4.1?pin=v135";

/** Shiki built-in themes we switch between on color mode. */
type ShikiTheme = "github-light" | "github-dark";

interface ShikiHighlighter {
  codeToHtml(
    code: string,
    options: { lang: string; theme: ShikiTheme },
  ): string;
  loadLanguage(lang: string): Promise<void>;
}

interface ShikiModule {
  createHighlighter(options: {
    themes: ShikiTheme[];
    langs: string[];
  }): Promise<ShikiHighlighter>;
}

interface MermaidModule {
  default: {
    initialize(config: {
      startOnLoad: boolean;
      theme: string;
      securityLevel: string;
      fontFamily?: string;
    }): void;
    render(id: string, code: string): Promise<{ svg: string }>;
  };
}

async function importFromUrl<T>(url: string): Promise<T> {
  return await import(/* @vite-ignore */ url) as T;
}

// The shiki highlighter is expensive to spin up and its grammars are loaded on
// demand, so cache a single instance (and per-language load promises) module-wide.
let shikiModule: ShikiModule | null = null;
let highlighterPromise: Promise<ShikiHighlighter> | null = null;
let highlighter: ShikiHighlighter | null = null;
const loadedLangs = new Set<string>(["text"]);
const langLoadPromises = new Map<string, Promise<void>>();

async function loadHighlighter(): Promise<ShikiHighlighter | null> {
  if (!isBrowserEnvironment()) return null;
  if (highlighter) return highlighter;

  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      shikiModule ??= await importFromUrl<ShikiModule>(ESM_SHIKI);
      return await shikiModule.createHighlighter({
        themes: ["github-light", "github-dark"],
        langs: ["text"],
      });
    })();
    // Reset the cached promise on failure so the next call can retry. Without
    // this, a transient network error (e.g. CSP, CDN blip) permanently locks
    // every subsequent highlight attempt against the same rejected promise —
    // the only recovery would be a full page reload.
    highlighterPromise.catch(() => {
      highlighterPromise = null;
    });
  }

  highlighter = await highlighterPromise;
  return highlighter;
}

async function ensureLanguage(lang: string): Promise<void> {
  if (!highlighter || loadedLangs.has(lang)) return;

  const existing = langLoadPromises.get(lang);
  if (existing) {
    await existing;
    return;
  }

  const load = highlighter
    .loadLanguage(lang)
    .then(() => {
      loadedLangs.add(lang);
    })
    .catch(() => {
      // Remove from the pending map so the next call can retry. Do NOT add
      // to loadedLangs — that would permanently mark a transiently-failed
      // load as succeeded and suppress all future retries for this language.
      langLoadPromises.delete(lang);
    });
  langLoadPromises.set(lang, load);
  await load;
}

let mermaidPromise: Promise<MermaidModule> | null = null;
let mermaidModule: MermaidModule | null = null;
let mermaidTheme: "dark" | "default" | null = null;

async function loadMermaid(
  theme: "dark" | "default",
): Promise<MermaidModule | null> {
  if (!isBrowserEnvironment()) return null;

  mermaidPromise ??= importFromUrl<MermaidModule>(ESM_MERMAID);
  mermaidModule = await mermaidPromise;

  // Re-initialize when the theme flips so the SVG re-renders in the new palette.
  if (mermaidTheme !== theme) {
    mermaidModule.default.initialize({
      startOnLoad: false,
      theme,
      securityLevel: "strict",
      fontFamily: "inherit",
    });
    mermaidTheme = theme;
  }

  return mermaidModule;
}

// ---------------------------------------------------------------------------
// MermaidDiagram — ported from Studio's MermaidDiagram, next-themes swapped for
// useColorMode, Skeleton kept, printReadiness dropped.
// ---------------------------------------------------------------------------

function MermaidDiagram(
  { code, className, resolvedMode }: {
    code: string;
    className?: string;
    resolvedMode: CodeBlockMode;
  },
): React.ReactElement {
  const [svg, setSvg] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");

  React.useEffect(() => {
    if (!isBrowserEnvironment() || !code.trim()) return;

    let cancelled = false;
    const theme = resolvedMode === "dark" ? "dark" : "default";

    async function render(): Promise<void> {
      try {
        const mermaid = await loadMermaid(theme);
        if (!mermaid || cancelled) return;

        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: rendered } = await mermaid.default.render(id, code.trim());
        if (cancelled) return;
        setSvg(validateTrustedHtml(rendered, { strict: true }));
        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to render diagram",
        );
        setSvg("");
      }
    }

    render();

    return () => {
      cancelled = true;
    };
  }, [code, resolvedMode]);

  if (error) {
    return (
      <div
        className={cn(
          "rounded-[var(--radius-md)] border border-[var(--outline-border)] p-3 text-sm",
          className,
        )}
      >
        <p className="font-medium">Diagram error</p>
        <pre className="mt-1 whitespace-pre-wrap text-xs">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return <Skeleton className={cn("h-32 rounded-[var(--radius-md)]", className)} />;
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-[var(--secondary)] p-3 [&_svg]:max-w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ---------------------------------------------------------------------------
// CodeBlock
// ---------------------------------------------------------------------------

/** Props accepted by `<CodeBlock>`. */
export interface CodeBlockProps {
  /** The source code to render. */
  code: string;
  /** Language id for syntax highlighting (e.g. `tsx`, `json`, `mermaid`). */
  language?: string;
  /** Additional class names for the outer container. */
  className?: string;
  /** Render inside a collapsible shell (header stays, body toggles). */
  collapsible?: boolean;
  /** When `collapsible`, start collapsed. @default false */
  defaultCollapsed?: boolean;
  /**
   * Force the highlight theme. Defaults to the `ColorModeProvider` when present,
   * else `light` — so `CodeBlock` renders standalone (e.g. inside markdown)
   * without requiring a provider.
   */
  mode?: CodeBlockMode;
  /** Override the idle copy icon in the header copy button. */
  copyIcon?: React.ReactNode;
  /** Override the collapse chevron icon (only used when `collapsible`). */
  collapseIcon?: React.ReactNode;
  /**
   * Intercept the built-in header copy. The caller runs first and must call
   * `next()` to actually copy.
   */
  onCopy?: (e: React.MouseEvent, next: () => void) => void;
  /**
   * Replace the header row entirely. Receives the language label, a `copy`
   * trigger, and (for the collapsible variant) the `collapsed` state + a
   * `toggle`. When provided, the built-in header/trigger row is not rendered.
   */
  renderHeader?: (opts: {
    language?: string;
    copy: () => void;
    collapsed: boolean;
    toggle: () => void;
  }) => React.ReactNode;
}

/** Result of {@link useClipboard}: the copied flag + a `copy` trigger. */
export interface UseClipboardResult {
  /** `true` for ~2s after a successful (or fallback) copy. */
  copied: boolean;
  /** Copy `text` to the clipboard (with a `execCommand` fallback). */
  copy: () => void;
}

/** Clipboard copy hook: copies `text`, flips `copied` for ~2s. */
export function useClipboard(text: string): UseClipboardResult {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
    };
  }, []);

  const copy = React.useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        /* expected: clipboard API unavailable, using fallback */
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    })();
  }, [text]);
  return { copied, copy };
}

/** Props accepted by {@link CopyButton}. */
export interface CopyButtonProps {
  /** The text copied to the clipboard on click. */
  code: string;
  /**
   * Override the idle copy icon (the copied/check state is unchanged). When
   * omitted, the built-in {@link CopyIcon} is used.
   */
  copyIcon?: React.ReactNode;
  /**
   * Intercept the built-in copy. The caller runs first and must call `next()`
   * to actually copy. When omitted, the copy happens directly.
   */
  onCopy?: (e: React.MouseEvent, next: () => void) => void;
}

// Icon-only copy control (Studio's ChatCodeBlock copy = `icon-ghost`/`icon-sm`,
// no "Copy" text). The label lives in the hover tooltip instead.
export function CopyButton(
  { code, copyIcon, onCopy }: CopyButtonProps,
): React.ReactElement {
  const { copied, copy } = useClipboard(code);
  const handleClick = (e: React.MouseEvent): void => {
    if (onCopy) onCopy(e, copy);
    else copy();
  };
  return (
    <IconButton
      variant="icon-ghost"
      size="icon-sm"
      onClick={handleClick}
      tooltip={copied ? "Copied" : "Copy code"}
      aria-label="Copy code"
      className="-mr-1 text-[var(--faint)] hover:text-[var(--foreground)]"
    >
      {/* icons render a half-step smaller than Studio: size-4 -> size-3.5 */}
      {copied
        ? <CheckIcon className="size-3.5" />
        : (copyIcon ?? <CopyIcon className="size-3.5" />)}
    </IconButton>
  );
}

/** Props accepted by {@link CodeSurface}. */
export interface CodeSurfaceProps {
  /** The source code to highlight. */
  code: string;
  /** Language id for syntax highlighting (defaults handled by the caller). */
  language: string;
  /** Resolved light/dark mode for the shiki theme. */
  resolvedMode: CodeBlockMode;
}

/**
 * The code surface. Plain highlighted code is ALWAYS visible immediately —
 * shiki is progressive enhancement layered on top once it lazy-loads from
 * esm.sh (so a stalled/blocked network never leaves an empty "no code block").
 */
export function CodeSurface({
  code,
  language,
  resolvedMode,
}: CodeSurfaceProps): React.ReactElement {
  const [html, setHtml] = React.useState<string>("");

  React.useEffect(() => {
    if (!isBrowserEnvironment()) return;

    let cancelled = false;
    const theme: ShikiTheme = resolvedMode === "dark" ? "github-dark" : "github-light";

    async function highlight(): Promise<void> {
      try {
        const hl = await loadHighlighter();
        if (!hl || cancelled) return;

        await ensureLanguage(language);
        if (cancelled) return;

        const lang = loadedLangs.has(language) ? language : "text";
        const rendered = hl.codeToHtml(code.trim(), { lang, theme });
        if (cancelled) return;
        setHtml(validateTrustedHtml(rendered, { strict: true }));
      } catch (_err) {
        // Graceful fallback — the plain <pre> below stays.
        if (!cancelled) setHtml("");
      }
    }

    setHtml("");
    highlight();

    return () => {
      cancelled = true;
    };
  }, [code, language, resolvedMode]);

  // Highlighted surface, once shiki has produced HTML.
  if (html && isBrowserEnvironment()) {
    return (
      <div
        className={cn(
          "overflow-x-auto text-sm",
          // Strip shiki's own <pre> chrome so it inherits our container.
          "[&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-3 [&_.shiki]:!bg-transparent",
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Always-visible base: plain code (SSR, pre-highlight, or fallback).
  return (
    <pre className="overflow-x-auto p-3 text-sm text-[var(--foreground)]">
      <code className={language ? `language-${language}` : undefined}>
        {code.trim()}
      </code>
    </pre>
  );
}

/** Render a syntax-highlighted code block (or a mermaid diagram). */
export function CodeBlock({
  code,
  language,
  className,
  collapsible = false,
  defaultCollapsed = false,
  mode,
  copyIcon,
  collapseIcon,
  onCopy,
  renderHeader,
}: CodeBlockProps): React.ReactElement {
  const lang = language ?? "text";
  // Hook called unconditionally; prop wins, else provider, else light. Never throws.
  const contextMode = useColorModeOptional()?.resolvedMode;
  const resolvedMode: CodeBlockMode = mode ?? contextMode ?? "light";

  // Control the collapsible open state locally so `renderHeader` can expose a
  // working `collapsed`/`toggle` (DOM output is identical to the uncontrolled
  // default). Hook is called unconditionally.
  const [open, setOpen] = React.useState(!defaultCollapsed);
  const toggle = React.useCallback(() => setOpen((v) => !v), []);
  // A `copy` trigger for `renderHeader` that honours `onCopy`.
  const clipboard = useClipboard(code);
  const copy = React.useCallback(() => {
    if (onCopy) {
      onCopy({} as React.MouseEvent, clipboard.copy);
    } else {
      clipboard.copy();
    }
  }, [onCopy, clipboard]);

  // Mermaid fences render as an SVG diagram, no chrome.
  if (language === "mermaid" && code.trim()) {
    return (
      <MermaidDiagram
        code={code}
        className={className}
        resolvedMode={resolvedMode}
      />
    );
  }

  const header = (
    <div className="flex items-center justify-between py-1.5 pl-3 pr-1.5 text-xs text-[var(--faint)]">
      <span className="font-mono font-medium">{lang}</span>
      <CopyButton code={code} copyIcon={copyIcon} onCopy={onCopy} />
    </div>
  );

  const surface = <CodeSurface code={code} language={lang} resolvedMode={resolvedMode} />;

  if (collapsible) {
    return (
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className={cn(
          "not-prose my-4 overflow-hidden rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-[var(--secondary)]",
          className,
        )}
      >
        {renderHeader ? renderHeader({ language, copy, collapsed: !open, toggle }) : (
          /* Trigger + copy are siblings (not nested — that would be a
              button-in-button). The trigger is `flex-1`, so the whole row toggles
              the body; the in-flow copy button keeps the header the same height as
              the flat variant. */
          <div className="flex items-center py-1.5 pl-3 pr-1.5 text-xs text-[var(--faint)]">
            <CollapsibleTrigger className="group flex flex-1 items-center gap-1.5 font-mono font-medium text-[var(--faint)] transition-colors hover:text-[var(--foreground)]">
              {/* icons render a half-step smaller than Studio: size-4 -> size-3.5 */}
              {collapseIcon ?? (
                <ChevronDownIcon className="size-3.5 shrink-0 transition-transform duration-100 group-data-[state=closed]:-rotate-90" />
              )}
              <span>{lang}</span>
            </CollapsibleTrigger>
            <CopyButton code={code} copyIcon={copyIcon} onCopy={onCopy} />
          </div>
        )}
        <CollapsibleContent className="border-t border-[var(--outline-border)]">
          {surface}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div
      className={cn(
        "not-prose my-4 overflow-hidden rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-[var(--secondary)]",
        className,
      )}
    >
      {renderHeader ? renderHeader({ language, copy, collapsed: !open, toggle }) : header}
      <div className="border-t border-[var(--outline-border)]">{surface}</div>
    </div>
  );
}
CodeBlock.displayName = "CodeBlock";
