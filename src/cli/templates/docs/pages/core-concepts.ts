/**
 * Docs template - Core concepts page template
 * @module
 */

import type { TemplateFile } from "./types.ts";

/**
 * Core concepts guide template
 *
 * Provides:
 * - Architecture overview
 * - Component-based design
 * - File-system routing
 * - Server-first approach
 * - Progressive enhancement
 * - Data flow explanation
 * - State management patterns
 * - Performance optimizations
 *
 * @returns Template file for app/docs/core-concepts/page.mdx
 */
export const coreConceptsTemplate: TemplateFile = {
  path: "app/docs/core-concepts/page.mdx",
  content: `# Core Concepts

Understanding these core concepts will help you build better applications.

## Architecture Overview

Our platform is built on these key principles:

### 1. Component-Based

Everything is a component that can be composed together:

\`\`\`typescript
export function MyComponent({ name }: { name: string }) {
  return <div>Hello, {name}!</div>;
}
\`\`\`

### 2. File-System Routing

Routes are automatically generated based on your file structure:

- \`app/page.tsx\` → \`/\`
- \`app/about/page.tsx\` → \`/about\`
- \`app/blog/[slug]/page.tsx\` → \`/blog/:slug\`

### 3. Server-First

By default, components run on the server for better performance:

\`\`\`typescript
// This runs on the server
export default async function Page() {
  const data = await fetchData();
  return <div>{data}</div>;
}
\`\`\`

### 4. Progressive Enhancement

Add client interactivity only where needed:

\`\`\`typescript
'use client';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(count + 1)}>
      Count: {count}
    </button>
  );
}
\`\`\`

## Data Flow

Understanding how data flows through your application:

1. **Request** - User navigates to a route
2. **Routing** - System matches the URL to a page
3. **Data Fetching** - Page fetches required data
4. **Rendering** - Server renders the HTML
5. **Hydration** - Client adds interactivity

## State Management

Manage state at different levels:

- **Component State** - Local to a component
- **Context** - Shared across components
- **Server State** - Fetched from APIs
- **URL State** - Stored in query parameters

## Performance

Built-in optimizations include:

- Automatic code splitting
- Resource prefetching
- Image optimization
- Caching strategies`,
};
