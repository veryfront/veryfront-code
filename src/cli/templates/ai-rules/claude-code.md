# Veryfront Project

Zero-config React meta-framework for AI-native applications.

## Quick Reference

| Command                          | Purpose                                  |
| -------------------------------- | ---------------------------------------- |
| `veryfront dev`                  | Start dev server (http://localhost:3000) |
| `veryfront build`                | Production build                         |
| `veryfront deploy`               | Deploy to Veryfront cloud                |
| `veryfront generate page <name>` | Generate new page                        |
| `veryfront generate api <name>`  | Generate API route                       |

## Project Structure

- `src/pages/*.tsx` → Routes (file-based routing)
- `src/api/*.ts` → API endpoints (`/api/*`)
- `src/components/` → Shared components
- `agents/` → AI agents
- `tools/` → MCP tools

## When Asked to Add Features

1. **Pages**: Create in `src/pages/` (e.g., `about.tsx` → `/about`)
2. **APIs**: Create in `src/api/` (e.g., `users.ts` → `/api/users`)
3. **Components**: Create in `src/components/`
4. **AI Agents**: Create in `agents/`

## Code Patterns

```tsx
// Page (src/pages/about.tsx)
export default function About() {
  return <h1>About</h1>;
}

// API (src/api/hello.ts)
export function GET() {
  return Response.json({ message: "Hello" });
}

// Dynamic API (src/api/users/[id].ts)
export function GET(_req: Request, { params }: { params: { id: string } }) {
  return Response.json({ id: params.id });
}
```

## Conventions

- Use TypeScript
- Use React 19 features
- Use Tailwind for styling
- Co-locate tests (`*.test.ts`)
- Use `@veryfront/*` imports

## Testing

- Run `veryfront dev` and check browser
- API endpoints at `/api/*`
- Run `deno task test` for tests
