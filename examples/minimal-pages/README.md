# Minimal Pages Router Example

A tiny Pages Router app demonstrating static pages and an API route.

## Structure

- `pages/index.mdx` - Home page
- `pages/about.mdx` - About page
- `pages/api/echo.ts` - Simple API route

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

## API Routes

Test the echo API:

```bash
curl "http://localhost:3002/api/echo?q=hello"
# Returns: {"ok":true,"echo":"hello"}
```

## Files

- `pages/index.mdx` - Home page with frontmatter
- `pages/about.mdx` - About page
- `pages/api/echo.ts` - Echo API endpoint
- `package.json` - Project dependencies
