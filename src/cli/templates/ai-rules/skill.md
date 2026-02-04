---
name: veryfront
description: Build and deploy fullstack AI-native React apps with Veryfront CLI
license: MIT
compatibility: Claude Code, Cursor, VS Code, Codex, Gemini CLI
metadata:
  author: veryfront
  version: "1.0"
---

# Veryfront

Zero-config React meta-framework for AI-native applications.

## Commands

| Command                          | Purpose                           |
| -------------------------------- | --------------------------------- |
| `veryfront dev`                  | Start development server with HMR |
| `veryfront build`                | Build for production              |
| `veryfront deploy`               | Deploy to Veryfront cloud         |
| `veryfront generate page <name>` | Generate a new page               |
| `veryfront generate api <name>`  | Generate an API route             |

## Project Structure

```
src/
├── pages/           # File-based routing (*.tsx → routes)
├── api/             # API routes (*.ts → /api/*)
├── components/      # Shared React components
├── ai/
│   ├── agents/      # AI agents
│   └── tools/       # MCP tools
└── styles/          # Global styles
```

## Adding Features

- **New page**: Create `src/pages/about.tsx` → `/about`
- **API endpoint**: Create `src/api/users.ts` → `/api/users`
- **AI agent**: Create `agents/assistant.ts`
- **MCP tool**: Create `tools/search.ts`

## Code Examples

### Page Component

```tsx
// src/pages/about.tsx
export default function About() {
  return <h1>About</h1>;
}
```

### API Route

```ts
// src/api/hello.ts
export function GET() {
  return Response.json({ message: "Hello" });
}
```

### Dynamic API Route

```ts
// src/api/users/[id].ts
export function GET(_req: Request, { params }: { params: { id: string } }) {
  return Response.json({ id: params.id });
}
```

## Conventions

- TypeScript required
- React 19 features (use, Server Components)
- Tailwind CSS for styling
- Co-locate tests with implementation
- Use `#veryfront/*` imports for framework modules

## Testing

- Development: `veryfront dev` (http://localhost:3000)
- API endpoints: `/api/*`
- Run tests: `deno task test`
