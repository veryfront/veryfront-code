# Veryfront Router System

Veryfront supports two routing strategies:

1. **App Router** (Recommended): File-system based routing using `app/` directory.
2. **Pages Router** (Legacy): File-system based routing using `pages/` directory.

## App Router

The App Router uses `layout.tsx` and `page.tsx` files to define routes.
It supports Server Components (RSC) and streaming by default.

### Nested Routes

Folders define the URL path.
`app/blog/page.tsx` -> `/blog`

### Dynamic Routes

Use square brackets for dynamic segments.
`app/posts/[slug]/page.tsx` -> `/posts/hello-world`
