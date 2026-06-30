import * as React from "react";
import { codeToHtml } from "shiki";
import { Check, Copy } from "./icons";
import { cn } from "./cn";
import { StorybookProviders } from "../StorybookProviders";
import { composeJsx, resolveArgsSpread } from "./composeJsx";
import { DocsSurface } from "./DocsSurface";
import { transformVeryfrontStorySource } from "./transformStorySource";

type View = "preview" | "code";

type StoryExport = {
  render?: (args: Record<string, unknown>) => React.ReactNode;
  args?: Record<string, unknown>;
  parameters?: {
    docs?: {
      source?: {
        code?: string;
        originalSource?: string;
      };
    };
  };
};

function TabButton(
  { active, onClick, children }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 text-xs font-normal rounded-full transition-colors cursor-pointer",
        active
          ? "bg-tint text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function useTheme() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  });
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(
        document.documentElement.getAttribute("data-theme") === "dark"
          ? "dark"
          : "light",
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

const lineNumberStyles = `
  .docs-example-auto-shiki pre {
    white-space: pre !important;
    margin: 0 !important;
    padding: 1rem !important;
    background: transparent !important;
    border: 0 !important;
  }
  .docs-example-auto-shiki code {
    counter-reset: line;
    display: block;
  }
  .docs-example-auto-shiki code .line {
    counter-increment: line;
    display: block;
  }
  .docs-example-auto-shiki:not([data-single-line='true']) code .line::before {
    content: counter(line);
    display: inline-block;
    width: 2rem;
    margin-right: 1rem;
    text-align: right;
    color: var(--muted-foreground);
    opacity: 0.4;
  }
`;

function CodePanel({ code }: { code: string }) {
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  const theme = useTheme();
  const trimmed = code.trim();
  const isSingleLine = !trimmed.includes("\n");

  React.useEffect(() => {
    let cancelled = false;
    void codeToHtml(trimmed, {
      lang: "tsx",
      theme: theme === "dark" ? "github-dark" : "github-light",
    }).then((html) => {
      if (cancelled) return;
      const patched = html
        .replace(
          /<pre /,
          '<pre style="white-space:pre;margin:0;padding:1rem;background:transparent" ',
        )
        .replace(/<code>/, '<code style="white-space:pre">')
        .replace(/<\/span>\n<span class="line">/g, '</span><span class="line">');
      setHighlighted(patched);
    });
    return () => {
      cancelled = true;
    };
  }, [trimmed, theme]);

  return (
    <div
      className="docs-example-auto-shiki bg-card text-[13px] leading-relaxed"
      data-single-line={isSingleLine}
    >
      {highlighted
        ? (
          <div
            className="overflow-x-auto"
            // deno-lint-ignore react-no-danger
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        )
        : (
          <pre style={{ whiteSpace: "pre", padding: "1rem", margin: 0 }}>
            <code>{trimmed}</code>
          </pre>
        )}
    </div>
  );
}

function getComponentName(
  Component: React.ComponentType<unknown> | undefined,
): string | null {
  if (!Component) return null;
  // Forward refs and memo wrappers expose the underlying component on .type.
  // displayName wins when set, then function name.
  const inner =
    (Component as { type?: { displayName?: string; name?: string } }).type;
  return (
    (Component as { displayName?: string }).displayName ??
      inner?.displayName ??
      (Component as { name?: string }).name ??
      inner?.name ??
      null
  );
}

export function extractSource(
  story: StoryExport,
  Component?: React.ComponentType<unknown>,
  args?: Record<string, unknown>,
): string {
  const explicit = story.parameters?.docs?.source?.code;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  const mergedArgs = args ?? story.args ?? {};
  const original = story.parameters?.docs?.source?.originalSource;
  if (typeof original === "string" && original.length > 0) {
    // Use the veryfront variant so the review-harness wrappers (StoryFrame /
    // ReviewSurface / vf-story-canvas) are stripped from the Code panel, the
    // same way the global `parameters.docs.source.transform` strips them for
    // standard autodocs. The base transform alone leaves the scaffolding in.
    const transformed = transformVeryfrontStorySource(original);
    // If the transform returned the unchanged args literal, fall through
    // to the JSX synthesis path below.
    if (!transformed.trim().startsWith("{")) {
      return resolveArgsSpread(transformed, mergedArgs);
    }
  }
  // Args-only story with `as={Component}`: synthesise JSX from merged args.
  const componentName = getComponentName(Component);
  if (componentName) {
    return composeJsx(componentName, mergedArgs);
  }
  return original ?? "";
}

/**
 * Tabbed Preview/Code wrapper for autodocs pages. Reads the story export
 * directly — calls `story.render()` for the preview and pulls source from
 * `parameters.docs.source.code` (set explicitly by the author or by
 * Storybook's CSF source loader). This bypasses Storybook's `<Story of>`
 * and `<Source of>` blocks entirely so the same docs page can reference
 * stories that live in a different CSF meta (e.g. an unattached MDX docs
 * shell at `Component/Docs` rendering stories from `Component/Examples`).
 *
 * For args-based stories (no `render` field), pass the component via `as`
 * so the wrapper can render `<as {...story.args} />`. Pair with per-story
 * `parameters.docs.source.code` overrides matching the teaching snippet
 * because `originalSource` for args stories serialises the args literal,
 * not the JSX.
 *
 * Decorators applied at the preview-iframe level by `.storybook/preview.tsx`
 * are re-applied via `StorybookProviders` so direct `render()` calls inherit
 * the same provider tree as Storybook-mounted stories.
 */
export function DocsExampleAuto({
  of,
  meta,
  as: Component,
  className,
}: {
  of: unknown;
  // Pass the stories module's default export so meta.args is merged with
  // story.args (matches how Storybook's own renderer composes args).
  meta?: { args?: Record<string, unknown> };
  // Accept any component shape — we forward merged args as props so the
  // caller is responsible for ensuring args satisfy the component's contract.
  as?: React.ComponentType<never>;
  className?: string;
}) {
  const story = of as StoryExport;
  const mergedArgs = { ...(meta?.args ?? {}), ...(story.args ?? {}) };
  const code = extractSource(
    story,
    Component as React.ComponentType<unknown> | undefined,
    mergedArgs,
  );
  let preview: React.ReactNode = null;
  if (story.render) {
    // Pass args into render so stories declared as `render: (args) => <X {...args} />`
    // also render in autodocs. Render-only stories (no `args`) ignore the empty object.
    preview = story.render(mergedArgs);
  } else if (Component) {
    // Render the component with whatever args are provided (may be empty).
    // Lets stories with default props (no required args) preview correctly.
    const Comp = Component as React.ComponentType<Record<string, unknown>>;
    preview = <Comp {...mergedArgs} />;
  } else {
    // Args-only story without `as={Component}` — silently rendering nothing
    // is the worst failure mode (Code tab shows args, Preview is blank). Make
    // the misconfiguration visible so authors fix the docs page, not chase ghosts.
    preview = (
      <div className="text-xs text-destructive font-mono">
        DocsExampleAuto: args-only story is missing `as={"{Component}"}`. Pass
        the component so the preview can render.
      </div>
    );
  }

  const [view, setView] = React.useState<View>("preview");
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    const text = code.trim();
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <DocsSurface filled={false}>
      <style>{lineNumberStyles}</style>
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline-border bg-card">
        <div className="flex items-center gap-1">
          <TabButton
            active={view === "preview"}
            onClick={() => setView("preview")}
          >
            Preview
          </TabButton>
          <TabButton active={view === "code"} onClick={() => setView("code")}>
            Code
          </TabButton>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          aria-hidden={view !== "code"}
          tabIndex={view === "code" ? 0 : -1}
          className={cn(
            "p-1.5 mr-1 mt-1 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
            view !== "code" && "invisible pointer-events-none",
          )}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      {view === "preview"
        ? (
          <div
            className={cn(
              "p-8 overflow-x-auto [&_.h-screen]:!h-[33vh] [&_.h-screen]:!min-h-[18rem]",
              className,
            )}
          >
            <StorybookProviders>{preview}</StorybookProviders>
          </div>
        )
        : <CodePanel code={code} />}
    </DocsSurface>
  );
}
