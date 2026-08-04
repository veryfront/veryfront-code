/**
 * Dependency-free Markdown source presentation plus an explicit rich-renderer
 * capability boundary.
 *
 * Core never imports or silently substitutes a third-party Markdown parser.
 * Without an injected renderer, source is displayed verbatim in an escaped
 * `<pre><code>` surface. Applications that need semantic Markdown install a
 * trusted extension and inject its renderer through
 * {@link MarkdownRendererProvider} or the `renderer` prop.
 *
 * @module react/components/chat/markdown
 */
import * as React from "react";
import { cn } from "./theme.ts";

/** Props passed to a custom fenced-code renderer by a rich Markdown extension. */
export interface CodeBlockProps {
  /** Fence language identifier, or `undefined` for an unlabelled fence. */
  language: string | undefined;
  /** Fence source with meaningful leading and trailing whitespace preserved. */
  code: string;
  /** Always `false`; retained for renderer compatibility. */
  inline?: boolean;
}

/**
 * Common props available to injected element overrides.
 *
 * Rich-renderer extensions may add parser-specific fields at runtime. Core
 * deliberately models only framework-neutral React/HTML fields.
 */
export interface MarkdownElementRendererProps {
  children?: React.ReactNode;
  className?: string;
  href?: string;
  style?: React.CSSProperties;
  [key: string]: unknown;
}

/** Framework-neutral element overrides consumed only by an injected renderer. */
export type MarkdownComponents = Readonly<
  Record<string, React.ComponentType<MarkdownElementRendererProps>>
>;

/** Backward-compatible type name without a react-markdown dependency. */
export type Components = MarkdownComponents;

/** Input contract implemented by a trusted rich-Markdown extension. */
export interface MarkdownRendererProps {
  /** Unmodified Markdown source. */
  source: string;
  /** Optional framework-neutral element overrides. */
  components?: MarkdownComponents;
  /** Optional fenced-code override. */
  renderCodeBlock?: (props: CodeBlockProps) => React.ReactNode;
}

/** A trusted rich-Markdown renderer supplied by an extension or application. */
export type MarkdownRenderer = React.ComponentType<MarkdownRendererProps>;

/** Props accepted by {@link MarkdownRendererProvider}. */
export interface MarkdownRendererProviderProps {
  /** Renderer to install, or `null` to disable an inherited renderer. */
  renderer: MarkdownRenderer | null;
  children: React.ReactNode;
}

/** Raised when parser-specific options would otherwise be silently ignored. */
export class MarkdownRendererCapabilityError extends Error {
  override readonly name = "MarkdownRendererCapabilityError";
  readonly code = "VF_REACT_MARKDOWN_RENDERER_REQUIRED";

  constructor() {
    super(
      "Markdown components and fenced-code overrides require an injected rich renderer. " +
        "Install a trusted Markdown extension and pass its renderer through " +
        "<MarkdownRendererProvider renderer={...}> or the Markdown renderer prop.",
    );
  }
}

const MARKDOWN_RENDERER_CONTEXT_SYMBOL = Symbol.for(
  "veryfront.react.markdown-renderer-context",
);
const globalMarkdownRendererContext = globalThis as typeof globalThis & {
  [MARKDOWN_RENDERER_CONTEXT_SYMBOL]?: React.Context<MarkdownRenderer | null | undefined>;
};
// The default is `undefined`, not `null`, so a subtree with no provider is
// distinguishable from one whose provider passed `renderer={null}` to disable an
// inherited renderer. Both still render plain source; only the diagnostics care.
const MarkdownRendererContext = globalMarkdownRendererContext[MARKDOWN_RENDERER_CONTEXT_SYMBOL] ??
  (globalMarkdownRendererContext[MARKDOWN_RENDERER_CONTEXT_SYMBOL] = React.createContext<
    MarkdownRenderer | null | undefined
  >(undefined));

/**
 * Read the renderer installed for this subtree.
 *
 * Returns the renderer, `null` when a provider explicitly disabled rendering,
 * and `undefined` when no provider is present at all. Internal: chat uses the
 * distinction to tell a missing renderer apart from a deliberate plain surface.
 * Not part of the `veryfront/chat` public surface.
 */
export function useInstalledMarkdownRenderer(): MarkdownRenderer | null | undefined {
  return React.useContext(MarkdownRendererContext);
}

/** Provide a trusted rich-Markdown renderer to a React subtree. */
export function MarkdownRendererProvider({
  renderer,
  children,
}: MarkdownRendererProviderProps): React.ReactElement {
  return (
    <MarkdownRendererContext.Provider value={renderer}>
      {children}
    </MarkdownRendererContext.Provider>
  );
}

/** Props accepted by {@link Markdown}. */
export interface MarkdownProps {
  /** Markdown source to present. */
  children: string;
  /** Additional class name for the outer container. */
  className?: string;
  /** Per-instance renderer; `null` explicitly selects plain source. */
  renderer?: MarkdownRenderer | null;
  /** Forwarded only to an injected rich renderer. */
  renderCodeBlock?: (props: CodeBlockProps) => React.ReactNode;
  /** Forwarded only to an injected rich renderer. */
  components?: MarkdownComponents;
}

const MARKDOWN_CONTAINER_CLASS =
  "max-w-none min-w-0 overflow-hidden break-words text-base leading-relaxed text-[var(--foreground)] [overflow-wrap:anywhere]";

// Element styling for semantic output. Declared as descendant selectors rather
// than through the `@tailwindcss/typography` plugin, so consumers do not have
// to install that plugin. Tailwind preflight strips list markers, so
// `list-disc`/`list-decimal` and padding are restored here. Applied only on the
// renderer branch: plain source has no elements to style.
const MARKDOWN_PROSE_CLASS = [
  // paragraph rhythm
  "[&_p]:my-4",
  // lists — restore the markers and indentation preflight removes
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 [&_li]:pl-1",
  "[&_ul_ul]:my-1 [&_ol_ol]:my-1 [&_ul_ol]:my-1 [&_ol_ul]:my-1",
  "[&_li>p]:my-0 [&_li_p]:my-2",
  // headings
  "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold",
  // inline emphasis
  "[&_strong]:font-semibold [&_em]:italic",
  // inline code — `:not(pre)>code` targets bare inline code, because block code
  // lives inside the code block's own `<pre>`.
  "[&_:not(pre)>code]:rounded-[var(--radius-xs)] [&_:not(pre)>code]:bg-[var(--accent)] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:font-medium [&_:not(pre)>code]:text-[var(--foreground)]",
  // horizontal rule
  "[&_hr]:my-6 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[var(--edge-medium)]",
  // tables — a renderer emits bare `<table>`, so the chat surface supplies the
  // rules and padding rather than every renderer having to override the cells.
  "[&_table]:my-4 [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse",
  "[&_thead_tr]:border-b [&_thead_tr]:border-[var(--edge)]",
  "[&_tbody_tr]:border-b [&_tbody_tr]:border-[var(--edge)] [&_tbody_tr:last-child]:border-b-0",
  "[&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_td]:px-4 [&_td]:py-2",
  // margin reset for the container edges plus a width guard
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_*]:max-w-full",
].join(" ");

/**
 * Present Markdown source using an injected rich renderer or the explicit
 * dependency-free plain-source contract.
 */
export function Markdown({
  children,
  className,
  renderer,
  renderCodeBlock,
  components,
  ...unsupportedProps
}: MarkdownProps): React.ReactElement {
  const inheritedRenderer = React.useContext(MarkdownRendererContext);
  const unsupportedNames = Object.keys(unsupportedProps).sort();
  if (unsupportedNames.length > 0) {
    throw new TypeError(
      `Unsupported Markdown prop${unsupportedNames.length === 1 ? "" : "s"}: ${
        unsupportedNames.join(", ")
      }. Configure parser-specific options on the injected renderer instead.`,
    );
  }
  const Renderer = renderer === undefined ? inheritedRenderer : renderer;

  if (Renderer) {
    return (
      <div
        className={cn(MARKDOWN_CONTAINER_CLASS, MARKDOWN_PROSE_CLASS, className)}
        data-vf-markdown-renderer="extension"
      >
        <Renderer
          source={children}
          components={components}
          renderCodeBlock={renderCodeBlock}
        />
      </div>
    );
  }

  if (components !== undefined || renderCodeBlock !== undefined) {
    throw new MarkdownRendererCapabilityError();
  }

  return (
    <div
      className={cn(MARKDOWN_CONTAINER_CLASS, className)}
      data-vf-markdown-renderer="plain"
    >
      <pre
        aria-label="Markdown source"
        className="m-0 max-w-full whitespace-pre-wrap break-words font-inherit [overflow-wrap:anywhere]"
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}
