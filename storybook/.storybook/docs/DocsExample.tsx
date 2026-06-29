import {
  DocsContext,
  SourceContext,
  Story,
  useSourceProps,
} from "@storybook/addon-docs/blocks";
import type { ModuleExport } from "storybook/internal/types";
import * as React from "react";
import { codeToHtml } from "shiki";

// Boundary-safe port of the Veryfront Studio `DocsExample` block: a Preview /
// Code tab toggle, with shiki syntax highlighting + line numbers for the Code
// tab and a copy button. Studio pulls in `@/icons` and `@/shared` (forbidden
// here), so icons are inline SVG and the source string comes from Storybook's
// own `useSourceProps` instead of a hand-authored `code` prop.

type View = "preview" | "code";

function useThemeMode(): "light" | "dark" {
  const [theme, setTheme] = React.useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light"
  );
  React.useEffect(() => {
    if (typeof document === "undefined") return;
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

const tabBase: React.CSSProperties = {
  appearance: "none",
  border: "none",
  cursor: "pointer",
  borderRadius: "9999px",
  padding: "4px 10px",
  fontSize: "12px",
  lineHeight: "16px",
  transition: "color 0.12s, background 0.12s",
};

function TabButton(
  { active, onClick, children }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  },
): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? "vf-doc-tab vf-doc-tab--active" : "vf-doc-tab"}
      style={tabBase}
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      aria-label="Copy code"
      className="vf-doc-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        appearance: "none",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: "6px",
        borderRadius: "6px",
        display: "inline-flex",
        transition: "color 0.12s",
      }}
    >
      {copied
        ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )
        : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        )}
    </button>
  );
}

const lineNumberStyles = `
  .vf-code code { counter-reset: line; }
  .vf-code code .line { counter-increment: line; }
  .vf-code code .line::before {
    content: counter(line);
    display: inline-block;
    width: 2rem;
    margin-right: 1rem;
    text-align: right;
    color: oklch(from var(--foreground) l c h / 0.35);
  }
`;

export function DocsExample(
  { of }: { of: ModuleExport },
): React.ReactElement {
  const [view, setView] = React.useState<View>("preview");
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  const theme = useThemeMode();

  const docsContext = React.useContext(DocsContext);
  const sourceContext = React.useContext(SourceContext);
  const sourceProps = useSourceProps({ of }, docsContext, sourceContext);
  const code = (sourceProps.code ?? "").trim();

  React.useEffect(() => {
    if (!code) {
      setHighlighted(null);
      return;
    }
    let active = true;
    void codeToHtml(code, {
      lang: "tsx",
      theme: theme === "dark" ? "github-dark" : "github-light",
    }).then((html) => {
      if (!active) return;
      // Preserve whitespace; Storybook docs CSS otherwise collapses <pre>.
      setHighlighted(
        html
          .replace(
            /<pre /,
            '<pre style="white-space:pre;margin:0;padding:16px;background:transparent;overflow-x:auto" ',
          )
          .replace(/<code>/, '<code style="white-space:pre">'),
      );
    });
    return () => {
      active = false;
    };
  }, [code, theme]);

  return (
    <div
      style={{
        border: "1px solid var(--outline-border, rgba(0,0,0,0.1))",
        borderRadius: "12px",
        overflow: "hidden",
        background: "var(--background, #f0efe9)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--outline-border, rgba(0,0,0,0.08))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <TabButton active={view === "preview"} onClick={() => setView("preview")}>
            Preview
          </TabButton>
          <TabButton active={view === "code"} onClick={() => setView("code")}>
            Code
          </TabButton>
        </div>
        {code ? <CopyButton text={code} /> : null}
      </div>
      <div
        style={{
          display: view === "preview" ? "block" : "none",
          background: "var(--background, #f0efe9)",
        }}
      >
        <Story of={of} />
      </div>
      <div
        style={{
          display: view === "code" ? "block" : "none",
          background: "var(--background, #f0efe9)",
          fontSize: "13px",
          lineHeight: 1.6,
        }}
        className="vf-code"
      >
        <style>{lineNumberStyles}</style>
        {highlighted
          ? (
            <div
              // deno-lint-ignore react-no-danger
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          )
          : (
            <pre style={{ margin: 0, padding: "16px", whiteSpace: "pre", overflowX: "auto" }}>
              <code>{code}</code>
            </pre>
          )}
      </div>
    </div>
  );
}
