# Veryfront - Basic MDX Example

This example demonstrates zero-config MDX support in Veryfront:

- MDX pages with frontmatter
- MDX layouts for consistent page structure
- JSX components in Markdown
- Automatic MDX processing

## Setup

1. Install dependencies:

```bash
npm install
# or
deno install
```

2. Run the dev server:

```bash
npm run dev
# or
deno task dev
```

3. Visit http://localhost:3002

## What It Does

1. **MDX Pages**: Write pages in Markdown with JSX components
2. **Frontmatter Support**: YAML frontmatter for page metadata
3. **Layouts**: Reusable MDX layouts for consistent structure
4. **Zero Config**: Works out of the box, no configuration needed
5. **Full TypeScript**: Type-safe MDX with IntelliSense

## Files

- `pages/index.mdx` - Home page in MDX
- `pages/about.mdx` - About page in MDX
- `layouts/main.jsx` - Main layout template
- `package.json` - Project dependencies

## MDX Features

### Frontmatter
```mdx
---
title: My Page
description: Page description
author: John Doe
---

# {frontmatter.title}

By {frontmatter.author}
```

### JSX Components
```mdx
# My Page

Here's a React component in Markdown:

<MyCustomComponent prop="value" />

And regular Markdown still works!
```

### Layouts
```mdx
---
layout: main
---

This content will be wrapped in the main layout.
```

## Directory Structure

```
pages/
├── index.mdx          # Home page
└── about.mdx          # About page

layouts/
└── main.jsx           # Main layout
```

## Use Cases

- **Documentation Sites**: Write docs in Markdown with interactive examples
- **Blogs**: Content in MDX with custom components
- **Marketing Pages**: Landing pages with rich formatting
- **Hybrid Sites**: Mix MDX pages with React pages

## Next Steps

- Add more MDX pages
- Create custom MDX components
- Add more layouts
- Import and use React components
- Add syntax highlighting for code blocks
