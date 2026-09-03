"use client";

import ReactMarkdown from "react-markdown@9.0.3";
import remarkGfm from "remark-gfm@4.0.1";
import type { MarkdownRendererProps } from "veryfront/markdown";

/**
 * Rich Markdown for assistant answers.
 *
 * `veryfront/markdown` presents plain source until a renderer is installed, so
 * this component supplies one. Swap in any renderer that accepts
 * `MarkdownRendererProps` to change how answers are parsed and rendered.
 *
 * Assistant answers are untrusted input, so this renderer also owns the URL
 * policy: only http(s), mailto, and relative URLs survive, images render as
 * inert text instead of auto-loading remote content, and links open in a new
 * tab without leaking the opener or referrer. Keep an equivalent policy in any
 * renderer you swap in.
 */

const LINK_REL = "noopener noreferrer nofollow";

/** Allow http(s), mailto, and relative URLs; drop every other scheme. */
function sanitizeUrl(url: string): string {
  // Browsers ignore ASCII spaces and control characters while parsing a
  // scheme, so `java&#9;script:` and ` data:` navigate exactly like the bare
  // scheme does. Match against a copy with those characters removed so an
  // obfuscated scheme is recognised and dropped.
  const probe = Array.from(url)
    .filter((char) => char > " " && char !== "\u007f")
    .join("");
  if (/^(https?|mailto):/i.test(probe)) return url;
  return /^[a-z][a-z0-9+.-]*:/i.test(probe) ? "" : url;
}

export function MarkdownRenderer({ source }: MarkdownRendererProps): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={sanitizeUrl}
      components={{
        a: ({ href, children }) => (
          <a href={href || undefined} target="_blank" rel={LINK_REL}>
            {children}
          </a>
        ),
        // Auto-loading images would let an injected answer beacon to arbitrary
        // hosts. Render inert text, not an anchor: Markdown allows a linked
        // image (`[![alt](src)](href)`), and an anchor here would nest inside
        // that link, which is invalid HTML and breaks hydration.
        img: ({ src, alt }) => (
          <span title={typeof src === "string" ? src : undefined}>{alt || "image"}</span>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
