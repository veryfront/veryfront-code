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
  [MARKDOWN_RENDERER_CONTEXT_SYMBOL]?: React.Context<MarkdownRenderer | null>;
};
const MarkdownRendererContext = globalMarkdownRendererContext[MARKDOWN_RENDERER_CONTEXT_SYMBOL] ??
  (globalMarkdownRendererContext[MARKDOWN_RENDERER_CONTEXT_SYMBOL] = React.createContext<
    MarkdownRenderer | null
  >(null));

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
        className={cn(MARKDOWN_CONTAINER_CLASS, className)}
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
