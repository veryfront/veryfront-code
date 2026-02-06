# Veryfront Project Instructions

This is a Veryfront project - a zero-config React meta-framework for AI-native applications.

## CLI Commands

- `veryfront dev` - Start development server with hot module replacement
- `veryfront build` - Build for production deployment
- `veryfront deploy` - Deploy to Veryfront cloud
- `veryfront generate page <name>` - Scaffold a new page
- `veryfront generate api <name>` - Scaffold an API route

## File Structure

The project uses file-based routing:

- `src/pages/*.tsx` - React pages (automatically become routes)
- `src/api/*.ts` - API endpoints (accessible at `/api/*`)
- `src/components/` - Shared React components
- `agents/` - AI agent definitions
- `tools/` - MCP tool implementations

## Code Patterns

### Creating a Page

```tsx
// src/pages/about.tsx → accessible at /about
export default function About() {
  return <h1>About</h1>;
}
```

### Creating an API Endpoint

```ts
// src/api/hello.ts → accessible at /api/hello
export function GET() {
  return Response.json({ message: "Hello" });
}

export function POST(request: Request) {
  // Handle POST request
  return Response.json({ success: true });
}
```

### Dynamic Routes

```ts
// src/api/users/[id].ts → accessible at /api/users/:id
export function GET(_req: Request, { params }: { params: { id: string } }) {
  return Response.json({ userId: params.id });
}
```

## Technology Stack

- Runtime: Deno
- UI: React 19 with Server Components
- Styling: Tailwind CSS
- Language: TypeScript (required)

## Best Practices

- Co-locate test files with implementation (`*.test.ts`)
- Use `#veryfront/*` import aliases for framework modules
- Follow React 19 patterns (use hook, Server Components)
- Use Response.json() for API responses
