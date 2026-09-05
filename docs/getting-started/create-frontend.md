---
title: "Create frontend"
description: "Add a chat page that streams responses from a Veryfront agent."
order: 8
---

## Prerequisites

- A project created with [Create project](./create-project.md).
- The agent route from [Create API](./create-api.md).
- The dev server running (`veryfront dev`).

## Add the chat page

Replace `app/page.tsx` with a client page:

```tsx
// app/page.tsx
"use client";

import { Chat, useChat } from "veryfront/chat";
import { MarkdownRendererProvider } from "veryfront/markdown";
import { MarkdownRenderer } from "./markdown-renderer.tsx";

export default function Home() {
  const chat = useChat();

  return (
    <MarkdownRendererProvider renderer={MarkdownRenderer}>
      <Chat chat={chat} placeholder="Ask me anything..." />
    </MarkdownRendererProvider>
  );
}
```

`useChat()` uses `/api/ag-ui` by default. `Chat` renders the composer,
messages, loading state, and streamed assistant response.

Keep the `MarkdownRendererProvider` wrapper. Assistants answer in Markdown, and
`veryfront/markdown` presents plain escaped source until a renderer is
installed, so a `<Chat>` without one shows `- **Static type checking**` instead
of a bulleted list.

## Supply the Markdown renderer

[Create project](./create-project.md) preselects the `ai-agent` template, and
that starter, like the other chat starters, scaffolds
`app/markdown-renderer.tsx`, so those projects already have this file. Create it
yourself if yours does not: the `minimal` and `agentic-workflow` templates ship
without a renderer, as does a project you added Veryfront to.

```bash
npm install --save-exact react-markdown@9.0.3 remark-gfm@4.0.1
```

```tsx
// app/markdown-renderer.tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MarkdownRendererProps } from "veryfront/markdown";

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
```

`--save-exact` matters: these packages reach the browser through the module
pipeline, where a floating `^` range resolves to whatever is latest at request
time. Your renderer owns parsing, sanitization, and link policy: assistant
answers are untrusted input, so keep a URL policy like the one above in any
renderer you swap in. See
[Render Markdown in chat](../guides/chat-ui.md#render-markdown-in-chat) to swap
in a different renderer.

## Choose SSR-safe styles

Use build-time CSS when the initial server-rendered page must be styled. Good
options include Tailwind CSS, CSS Modules, and other tools that emit CSS during
the build.

Veryfront does not currently collect styles from runtime CSS-in-JS libraries
such as Emotion or styled-components during server rendering. A generated class
name may appear in the server HTML without its CSS rule because styles inserted
through `document.head` are not added to the response. This may leave the page
unstyled or cause a flash of unstyled content before client hydration.

Do not rely on runtime CSS-in-JS for SSR styling until Veryfront provides a
server style-collection and insertion API.

## Verify it worked

Open [http://localhost:3000](http://localhost:3000), send a message, and confirm:

- The assistant response streams into the chat.
- Ask for a bulleted list. The reply renders as formatted Markdown, not raw
  Markdown source: bullets and bold text, with no literal `-` or `**` markers
  and no `` ``` `` fences.
- The browser console reports no missing-Markdown-renderer warning.

For custom layouts, see [Chat UI](../guides/chat-ui.md).
