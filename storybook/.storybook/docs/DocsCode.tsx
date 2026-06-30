import * as React from "react";
import { codeToHtml } from "shiki";
import { Check, Copy } from "./icons";
import { cn } from "./cn";
import { DocsSurface } from "./DocsSurface";

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

/** Code-only block with Shiki syntax highlighting and copy button. No preview. */
export function DocsCode(
  { code, lang = "tsx", className }: {
    code: string;
    lang?: string;
    className?: string;
  },
) {
  const [copied, setCopied] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  const theme = useTheme();
  const trimmed = code.trim();
  const isSingleLine = !trimmed.includes("\n");

  React.useEffect(() => {
    void codeToHtml(trimmed, {
      lang,
      theme: theme === "dark" ? "github-dark" : "github-light",
    }).then((html) => {
      const patched = html
        .replace(
          /<pre /,
          '<pre style="white-space:pre;margin:0;padding:1rem;background:transparent" ',
        )
        .replace(/<code>/, '<code style="white-space:pre">');
      setHighlighted(patched);
    });
  }, [trimmed, lang, theme]);

  function handleCopy() {
    void navigator.clipboard.writeText(trimmed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <DocsSurface className={className}>
      <div className="relative">
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "absolute right-1.5 z-10 p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
            isSingleLine ? "top-1/2 -translate-y-1/2" : "top-1.5",
          )}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
        {highlighted
          ? (
            <div
              className="overflow-x-auto text-[13px] leading-relaxed"
              // deno-lint-ignore react-no-danger
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          )
          : (
            <pre
              style={{ whiteSpace: "pre", padding: "1rem", margin: 0 }}
              className="overflow-x-auto text-[13px] leading-relaxed"
            >
              <code>{trimmed}</code>
            </pre>
          )}
      </div>
    </DocsSurface>
  );
}
