# Veryfront Agent Instructions

This is a Veryfront project. Veryfront is a zero-config React meta-framework for AI-native applications.

## Commands

- `npx veryfront dev` - Start development server
- `npx veryfront build` - Build for production
- `npx veryfront deploy` - Deploy to cloud
- `npx veryfront generate page <name>` - Generate a page
- `npx veryfront generate api <name>` - Generate an API route

## File Conventions

- **Pages**: `src/pages/*.tsx` (file-based routing)
- **APIs**: `src/api/*.ts` (serverless functions at `/api/*`)
- **Components**: `src/components/*.tsx`
- **AI Agents**: `src/ai/agents/*.ts`
- **MCP Tools**: `src/ai/tools/*.ts`

## Examples

### Create a new page

```tsx
// src/pages/about.tsx
export default function About() {
  return <h1>About</h1>;
}
```

This page will be accessible at `/about`.

### Create an API endpoint

```ts
// src/api/hello.ts
export function GET() {
  return Response.json({ message: "Hello" });
}

export function POST(request: Request) {
  return Response.json({ success: true });
}
```

This API will be accessible at `/api/hello`.

### Create a dynamic API route

```ts
// src/api/users/[id].ts
export function GET(_req: Request, { params }: { params: { id: string } }) {
  return Response.json({ userId: params.id });
}
```

This API will be accessible at `/api/users/:id`.

## Technology Stack

- **Runtime**: Deno
- **UI Framework**: React 19
- **Styling**: Tailwind CSS
- **Language**: TypeScript

## Best Practices

- Co-locate tests with implementation files (`*.test.ts`)
- Use `@veryfront/*` import aliases
- Use React 19 features (use hook, Server Components)
- Return `Response.json()` from API routes
