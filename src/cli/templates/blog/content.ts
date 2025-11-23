/**
 * Blog template - Sample content
 */

import type { TemplateFile } from "../types.ts";

export const blogContentTemplates: TemplateFile[] = [
  {
    path: "content/posts/hello-world.mdx",
    content: `---
title: Hello World
date: 2024-01-01
author: Your Name
tags: [intro, meta]
excerpt: Welcome to my new blog built with Veryfront!
---

Welcome to my new blog! This is my first post built with Veryfront.

## Why Veryfront?

I chose Veryfront because:

1. **Deno-first** - No node_modules, secure by default
2. **Great MDX support** - Write content with React components
3. **Fast** - Built on modern web standards
4. **Simple** - Easy to understand and customize

## What's Next?

I'll be writing about:

- Web development tips and tricks
- My experiences with Deno and modern JavaScript
- Building applications with React Server Components
- And much more!

Stay tuned for more posts!`,
  },
  {
    path: "content/posts/markdown-showcase.mdx",
    content: `---
title: Markdown Showcase
date: 2024-01-02
author: Your Name
tags: [markdown, demo]
excerpt: A demonstration of all the Markdown features supported in Veryfront
---

This post showcases all the Markdown and MDX features available in Veryfront.

## Headers

### H3 Header
#### H4 Header
##### H5 Header
###### H6 Header

## Emphasis

*This text is italicized*
**This text is bold**
***This text is bold and italicized***
~~This text is struck through~~

## Lists

### Unordered List
- First item
- Second item
  - Nested item
  - Another nested item
- Third item

### Ordered List
1. First step
2. Second step
   1. Sub-step A
   2. Sub-step B
3. Third step

## Links and Images

[Visit Veryfront](https://github.com/veryfront/veryfront)

![Placeholder Image](https://via.placeholder.com/600x400)

## Code

Inline code: \`const greeting = "Hello, World!"\`

\`\`\`javascript
// Code block with syntax highlighting
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10)); // 55
\`\`\`

\`\`\`tsx
// React component
export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
\`\`\`

## Blockquotes

> "The best way to predict the future is to invent it."
> — Alan Kay

## Tables

| Feature | Supported | Notes |
|---------|-----------|--------|
| MDX | ✅ | Full support |
| RSC | ✅ | React Server Components |
| HMR | ✅ | Hot Module Replacement |
| TypeScript | ✅ | Built-in support |

## Task Lists

- [x] Set up Veryfront
- [x] Create first blog post
- [ ] Customize theme
- [ ] Add comments system

## Horizontal Rule

---

## MDX Components

You can also embed React components directly in your markdown:

<button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
  Click me!
</button>`,
  },
];
