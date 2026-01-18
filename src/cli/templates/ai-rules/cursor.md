# Veryfront Project

You are in a Veryfront project - zero-config React meta-framework for AI-native applications.

## Commands

- `veryfront dev` - Start development server with HMR
- `veryfront build` - Build for production
- `veryfront deploy` - Deploy to Veryfront cloud
- `veryfront generate page <name>` - Generate a new page
- `veryfront generate api <name>` - Generate an API route

## Project Structure

```
src/
├── pages/           # File-based routing (pages/*.tsx → routes)
├── api/             # API routes (api/*.ts → /api/*)
├── components/      # Shared React components
├── ai/
│   ├── agents/      # AI agents
│   └── tools/       # MCP tools
└── styles/          # Global styles
```

## Adding Features

- **New page**: Create `src/pages/about.tsx` → accessible at `/about`
- **API endpoint**: Create `src/api/users.ts` → accessible at `/api/users`
- **AI agent**: Create `agents/assistant.ts`
- **MCP tool**: Create `tools/search.ts`

## Conventions

- TypeScript required
- React 19 features (use, Server Components)
- Tailwind CSS for styling
- Co-locate tests with implementation (`*.test.ts`)
- Use `@veryfront/*` imports for framework modules

## File Patterns

```tsx
// Page component (src/pages/about.tsx)
export default function About() {
  return <h1>About</h1>;
}

// API route (src/api/hello.ts)
export function GET() {
  return Response.json({ message: "Hello" });
}

// API with params (src/api/users/[id].ts)
export function GET(_req: Request, { params }: { params: { id: string } }) {
  return Response.json({ id: params.id });
}
```

## Testing

- Run `veryfront dev` and check browser at http://localhost:3000
- API endpoints available at `/api/*`
- Use `deno task test` to run tests
