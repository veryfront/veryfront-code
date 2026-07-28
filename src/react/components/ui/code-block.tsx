/**
 * CodeBlock — the "ace" syntax-highlighted code primitive, forked
 * dependency-light from Veryfront Studio's `ChatCodeBlock`. Structurally 1:1
 * (shiki highlight + copy + language label + collapsible + mermaid), but:
 *
 * - **Themes:** shiki built-in `github-light` / `github-dark`, switched on our
 *   `useColorMode` — NOT Studio's `veryfrontDarkTheme`.
 * - **Dependency-light:** shiki and mermaid are package-owned, lazy imports.
 *   Plain source is rendered during SSR and while the browser enhancement
 *   loads.
 * - **Stripped (Studio-panel only):** `openTab`/`openPanel`/`openFilePath`/
 *   `executeCommand`, file previews, the actions dropdown, radix
 *   `useControllableState`, and `printReadiness`.
 *
 * Shared by `veryfront/ui` and the chat Markdown renderer.
 *
 * @module react/components/ui/code-block
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { useClipboardFeedback } from "../clipboard.ts";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "./icons/index.ts";
import { useColorModeOptional } from "./color-mode.tsx";
import { createRetryableModuleLoader, createSerialAsyncExecutor } from "./code-block-runtime.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx";
import { IconButton } from "./icon-button.tsx";

/** Light/dark, for switching the shiki + mermaid theme. */
type CodeBlockMode = "light" | "dark";

// ---------------------------------------------------------------------------
// Lazy package loaders
// ---------------------------------------------------------------------------

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

const shikiModuleLoader = createRetryableModuleLoader(
  () => import("shiki") as Promise<ShikiModule>,
);
const mermaidModuleLoader = createRetryableModuleLoader(
  () => import("mermaid") as Promise<MermaidModule>,
);

// The shiki highlighter is expensive to spin up and its grammars are loaded on
// demand, so cache a single instance (and per-language load promises) module-wide.
let highlighterPromise: Promise<ShikiHighlighter> | null = null;
let highlighter: ShikiHighlighter | null = null;
const loadedLangs = new Set<string>(["text"]);
const langLoadPromises = new Map<string, Promise<void>>();

async function loadHighlighter(): Promise<ShikiHighlighter | null> {
  if (!isBrowserEnvironment()) return null;
  if (highlighter) return highlighter;

  if (!highlighterPromise) {
    const current = (async () => {
      const shikiModule = await shikiModuleLoader.load();
      return await shikiModule.createHighlighter({
        themes: ["github-light", "github-dark"],
        langs: ["text"],
      });
    })();
    highlighterPromise = current;
    // Reset the cached promise on failure so the next call can retry. Without
    // this, a transient network error (e.g. CSP, CDN blip) permanently locks
    // every subsequent highlight attempt against the same rejected promise —
    // the only recovery would be a full page reload.
    current.catch(() => {
      if (highlighterPromise === current) highlighterPromise = null;
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
      // Do NOT add to loadedLangs — that would permanently mark a
      // transiently-failed load as succeeded and suppress future retries.
    })
    .finally(() => {
      if (langLoadPromises.get(lang) === load) langLoadPromises.delete(lang);
    });
  langLoadPromises.set(lang, load);
  await load;
}

let mermaidTheme: "dark" | "default" | null = null;
const executeMermaidRender = createSerialAsyncExecutor();

async function renderMermaid(
  id: string,
  code: string,
  theme: "dark" | "default",
  signal: AbortSignal,
): Promise<{ svg: string }> {
  return await executeMermaidRender(async () => {
    signal.throwIfAborted();
    const mermaidModule = await mermaidModuleLoader.load();
    signal.throwIfAborted();

    // Mermaid configuration is singleton state. Initialization and rendering
    // must stay in the same serialized operation or simultaneous light/dark
    // diagrams can race and use the wrong theme.
    if (mermaidTheme !== theme) {
      mermaidModule.default.initialize({
        startOnLoad: false,
        theme,
        securityLevel: "strict",
        fontFamily: "inherit",
      });
      mermaidTheme = theme;
    }

    signal.throwIfAborted();
    return await mermaidModule.default.render(id, code);
  });
}

// ---------------------------------------------------------------------------
// MermaidDiagram — ported from Studio's MermaidDiagram, next-themes swapped for
// useColorMode, printReadiness dropped.
// ---------------------------------------------------------------------------

interface MermaidRenderState {
  code: string;
  mode: CodeBlockMode;
  svg?: string;
  error?: string;
}

function MermaidDiagram(
  { code, className, resolvedMode }: {
    code: string;
    className?: string;
    resolvedMode: CodeBlockMode;
  },
): React.ReactElement {
  const [renderState, setRenderState] = React.useState<MermaidRenderState>();
  const renderId = `mermaid-${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const currentState = renderState?.code === code &&
      renderState.mode === resolvedMode
    ? renderState
    : undefined;

  React.useEffect(() => {
    if (!isBrowserEnvironment() || !code.trim()) return;

    const controller = new AbortController();
    const theme = resolvedMode === "dark" ? "dark" : "default";

    async function render(): Promise<void> {
      try {
        const { svg: rendered } = await renderMermaid(
          renderId,
          code.trim(),
          theme,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setRenderState({
          code,
          mode: resolvedMode,
          svg: validateTrustedHtml(rendered, { strict: true }),
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setRenderState({
          code,
          mode: resolvedMode,
          error: err instanceof Error ? err.message : "Failed to render diagram",
        });
      }
    }

    render();

    return () => {
      controller.abort();
    };
  }, [code, renderId, resolvedMode]);

  if (currentState?.error) {
    return (
      <div
        className={cn(
          "rounded-[var(--radius-md)] border border-[var(--outline-border)] p-3 text-sm",
          className,
        )}
      >
        <p className="font-medium">Diagram error</p>
        <pre className="mt-1 whitespace-pre-wrap text-xs">
          {currentState.error}
        </pre>
        <pre className="mt-3 overflow-x-auto text-xs">
          <code className="language-mermaid">{code}</code>
        </pre>
      </div>
    );
  }

  if (!currentState?.svg) {
    return (
      <pre
        className={cn(
          "overflow-x-auto rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-[var(--secondary)] p-3 text-sm text-[var(--foreground)]",
          className,
        )}
      >
        <code className="language-mermaid">{code}</code>
      </pre>
    );
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-[var(--secondary)] p-3 [&_svg]:max-w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: currentState.svg }}
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
    /**
     * Copy the code. Pass the click event (for example, with
     * `onClick={copy}`) when an `onCopy` interceptor is configured. Eventless
     * calls fail closed in that case because React events cannot be fabricated.
     */
    copy: (event?: React.MouseEvent) => void;
    collapsed: boolean;
    toggle: () => void;
  }) => React.ReactNode;
}

/** Result of {@link useClipboard}: transient copy feedback and a `copy` trigger. */
export interface UseClipboardResult {
  /** `true` for ~2s after a successful copy. */
  copied: boolean;
  /** `true` for ~2s after both available copy mechanisms fail. */
  failed: boolean;
  /** Copy `text` to the clipboard (with an `execCommand` fallback). */
  copy: (ownerDocument?: Document) => void;
}

/** Copy `text` and expose transient success or failure feedback. */
export function useClipboard(text: string): UseClipboardResult {
  const { outcome, copy: copyWithFeedback } = useClipboardFeedback();

  const copy = React.useCallback((ownerDocument?: Document): void => {
    void copyWithFeedback(text, ownerDocument);
  }, [copyWithFeedback, text]);
  const isCurrentText = outcome?.text === text;
  return {
    copied: isCurrentText && outcome?.status === "copied",
    failed: isCurrentText && outcome?.status === "failed",
    copy,
  };
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
  const { copied, failed, copy } = useClipboard(code);
  const label = copied ? "Copied" : failed ? "Unable to copy code" : "Copy code";
  const handleClick = (e: React.MouseEvent): void => {
    const ownerDocument = e.currentTarget.ownerDocument;
    const next = (): void => copy(ownerDocument);
    if (onCopy) onCopy(e, next);
    else next();
  };
  return (
    <>
      <IconButton
        variant="icon-ghost"
        size="icon-sm"
        onClick={handleClick}
        tooltip={label}
        aria-label={label}
        className="-mr-1 text-[var(--faint)] hover:text-[var(--foreground)]"
      >
        {/* icons render a half-step smaller than Studio: size-4 -> size-3.5 */}
        <span aria-hidden="true">
          {copied
            ? <CheckIcon className="size-3.5" />
            : (copyIcon ?? <CopyIcon className="size-3.5" />)}
        </span>
      </IconButton>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {copied ? "Code copied" : failed ? "Unable to copy code" : ""}
      </span>
    </>
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
 * The code surface. Plain source is always visible immediately; Shiki is
 * progressive enhancement layered on top once its package lazy-loads, so a
 * stalled or blocked load never leaves an empty code block.
 */
export function CodeSurface({
  code,
  language,
  resolvedMode,
}: CodeSurfaceProps): React.ReactElement {
  const [highlight, setHighlight] = React.useState<{
    code: string;
    language: string;
    mode: CodeBlockMode;
    html: string;
  }>();
  const currentHtml = highlight?.code === code &&
      highlight.language === language &&
      highlight.mode === resolvedMode
    ? highlight.html
    : "";

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
        const rendered = hl.codeToHtml(code, { lang, theme });
        if (cancelled) return;
        setHighlight({
          code,
          language,
          mode: resolvedMode,
          html: validateTrustedHtml(rendered, { strict: true }),
        });
      } catch (_err) {
        // Graceful fallback — the plain <pre> below stays.
        if (!cancelled) setHighlight(undefined);
      }
    }

    highlight();

    return () => {
      cancelled = true;
    };
  }, [code, language, resolvedMode]);

  // Highlighted surface, once shiki has produced HTML.
  if (currentHtml && isBrowserEnvironment()) {
    return (
      <div
        className={cn(
          "overflow-x-auto text-sm",
          // Strip shiki's own <pre> chrome so it inherits our container.
          "[&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-3 [&_.shiki]:!bg-transparent",
        )}
        dangerouslySetInnerHTML={{ __html: currentHtml }}
      />
    );
  }

  // Always-visible base: plain code (SSR, pre-highlight, or fallback).
  return (
    <pre className="overflow-x-auto p-3 text-sm text-[var(--foreground)]">
      <code className={language ? `language-${language}` : undefined}>
        {code}
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
  // `renderHeader` can pass a real click event to the interceptor. Imperative
  // calls without an event copy directly only when no interceptor is present;
  // an interceptor fails closed rather than receiving a fabricated event.
  const { copy: copyCode } = useClipboard(code);
  const hostDocumentRef = React.useRef<Document | undefined>(undefined);
  const captureHostDocument = React.useCallback((node: HTMLDivElement | null): void => {
    hostDocumentRef.current = node?.ownerDocument;
  }, []);
  const copy = React.useCallback((event?: React.MouseEvent): void => {
    const ownerDocument = event?.currentTarget.ownerDocument ?? hostDocumentRef.current;
    if (!ownerDocument) return;
    if (onCopy) {
      if (!event) return;
      const next = (): void => copyCode(ownerDocument);
      onCopy(event, next);
      return;
    }
    copyCode(ownerDocument);
  }, [copyCode, onCopy]);

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
        ref={captureHostDocument}
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
      ref={captureHostDocument}
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
