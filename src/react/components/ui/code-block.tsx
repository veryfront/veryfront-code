/**
 * Dependency-free code presentation with copy/collapse behavior and explicit
 * extension-owned syntax/diagram renderer capabilities. Core always has an
 * honest escaped `<pre><code>` representation and never imports, retries, or
 * silently substitutes a third-party highlighter.
 *
 * @module react/components/ui/code-block
 */
import * as React from "react";
import { cx as cn } from "./cva.ts";
import { useClipboardFeedback } from "../clipboard.ts";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "./icons/index.ts";
import { useColorModeOptional } from "./color-mode.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx";
import { IconButton } from "./icon-button.tsx";

/** Light/dark presentation mode forwarded to extension-owned renderers. */
export type CodeBlockMode = "light" | "dark";

/** Framework-neutral input for an extension-owned syntax renderer. */
export interface CodeSyntaxRendererProps {
  code: string;
  language: string;
  mode: CodeBlockMode;
}

/** Framework-neutral input for an extension-owned diagram renderer. */
export interface CodeDiagramRendererProps {
  code: string;
  language: string;
  mode: CodeBlockMode;
  className?: string;
}

/** Optional rich rendering capabilities supplied outside core. */
export interface CodeBlockRenderers {
  syntax?: React.ComponentType<CodeSyntaxRendererProps> | null;
  diagram?: React.ComponentType<CodeDiagramRendererProps> | null;
}

/** Props accepted by {@link CodeBlockRendererProvider}. */
export interface CodeBlockRendererProviderProps {
  renderers: CodeBlockRenderers;
  children: React.ReactNode;
}

interface ResolvedCodeBlockRenderers {
  syntax: React.ComponentType<CodeSyntaxRendererProps> | null;
  diagram: React.ComponentType<CodeDiagramRendererProps> | null;
}

const EMPTY_CODE_BLOCK_RENDERERS: ResolvedCodeBlockRenderers = Object.freeze({
  syntax: null,
  diagram: null,
});
const CODE_BLOCK_RENDERER_CONTEXT_SYMBOL = Symbol.for(
  "veryfront.react.code-block-renderer-context",
);
const globalCodeBlockRendererContext = globalThis as typeof globalThis & {
  [CODE_BLOCK_RENDERER_CONTEXT_SYMBOL]?: React.Context<ResolvedCodeBlockRenderers>;
};
const CodeBlockRendererContext =
  globalCodeBlockRendererContext[CODE_BLOCK_RENDERER_CONTEXT_SYMBOL] ??
    (globalCodeBlockRendererContext[CODE_BLOCK_RENDERER_CONTEXT_SYMBOL] = React.createContext(
      EMPTY_CODE_BLOCK_RENDERERS,
    ));

function mergeCodeBlockRenderers(
  inherited: ResolvedCodeBlockRenderers,
  renderers: CodeBlockRenderers | undefined,
): ResolvedCodeBlockRenderers {
  if (!renderers) return inherited;
  return Object.freeze({
    syntax: renderers.syntax === undefined ? inherited.syntax : renderers.syntax,
    diagram: renderers.diagram === undefined ? inherited.diagram : renderers.diagram,
  });
}

/** Provide extension-owned syntax and diagram renderers to a React subtree. */
export function CodeBlockRendererProvider({
  renderers,
  children,
}: CodeBlockRendererProviderProps): React.ReactElement {
  const inherited = React.useContext(CodeBlockRendererContext);
  const syntax = renderers.syntax;
  const diagram = renderers.diagram;
  const value = React.useMemo(
    () => mergeCodeBlockRenderers(inherited, { syntax, diagram }),
    [diagram, inherited, syntax],
  );
  return (
    <CodeBlockRendererContext.Provider value={value}>
      {children}
    </CodeBlockRendererContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// CodeBlock
// ---------------------------------------------------------------------------

/** Props accepted by `<CodeBlock>`. */
export interface CodeBlockProps {
  /** The source code to render. */
  code: string;
  /** Language id exposed to the plain surface or injected renderer. */
  language?: string;
  /** Additional class names for the outer container. */
  className?: string;
  /** Render inside a collapsible shell (header stays, body toggles). */
  collapsible?: boolean;
  /** When `collapsible`, start collapsed. @default false */
  defaultCollapsed?: boolean;
  /**
   * Force the renderer mode. Defaults to `ColorModeProvider` when present,
   * otherwise `light`.
   */
  mode?: CodeBlockMode;
  /** Per-instance renderer overrides; `null` explicitly selects plain source. */
  renderers?: CodeBlockRenderers;
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
  /** The source code to present. */
  code: string;
  /** Language id exposed to the plain surface or renderer. */
  language: string;
  /** Resolved light/dark mode. */
  resolvedMode: CodeBlockMode;
  /** Explicit extension-owned renderer; omitted or `null` renders plain source. */
  renderer?: React.ComponentType<CodeSyntaxRendererProps> | null;
}

/** Render through an explicit extension capability or escaped plain source. */
export function CodeSurface({
  code,
  language,
  resolvedMode,
  renderer,
}: CodeSurfaceProps): React.ReactElement {
  if (renderer) {
    const Renderer = renderer;
    return (
      <div
        className="overflow-x-auto text-sm"
        data-vf-code-renderer="extension"
      >
        <Renderer code={code} language={language} mode={resolvedMode} />
      </div>
    );
  }

  return (
    <pre
      className="overflow-x-auto p-3 text-sm text-[var(--foreground)]"
      data-vf-code-renderer="plain"
    >
      <code className={language ? `language-${language}` : undefined}>
        {code}
      </code>
    </pre>
  );
}

/** Render escaped source or delegate to explicit syntax/diagram capabilities. */
export function CodeBlock({
  code,
  language,
  className,
  collapsible = false,
  defaultCollapsed = false,
  mode,
  renderers,
  copyIcon,
  collapseIcon,
  onCopy,
  renderHeader,
}: CodeBlockProps): React.ReactElement {
  const lang = language ?? "text";
  // Hook called unconditionally; prop wins, else provider, else light. Never throws.
  const contextMode = useColorModeOptional()?.resolvedMode;
  const resolvedMode: CodeBlockMode = mode ?? contextMode ?? "light";
  const inheritedRenderers = React.useContext(CodeBlockRendererContext);
  const syntaxRenderer = renderers?.syntax === undefined
    ? inheritedRenderers.syntax
    : renderers.syntax;
  const diagramRenderer = renderers?.diagram === undefined
    ? inheritedRenderers.diagram
    : renderers.diagram;

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

  // Diagram rendering is extension-owned. Without that explicit capability a
  // mermaid fence follows the ordinary escaped source path below.
  if (language === "mermaid" && code.trim() && diagramRenderer) {
    const DiagramRenderer = diagramRenderer;
    return (
      <DiagramRenderer
        code={code}
        language={language}
        className={className}
        mode={resolvedMode}
      />
    );
  }

  const header = (
    <div className="flex items-center justify-between py-1.5 pl-3 pr-1.5 text-xs text-[var(--faint)]">
      <span className="font-mono font-medium">{lang}</span>
      <CopyButton code={code} copyIcon={copyIcon} onCopy={onCopy} />
    </div>
  );

  const surface = (
    <CodeSurface
      code={code}
      language={lang}
      resolvedMode={resolvedMode}
      renderer={syntaxRenderer}
    />
  );

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
