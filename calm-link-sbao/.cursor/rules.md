# calm-link-sbao-k834a0

AI-powered application with chat interface built with Veryfront.

## Tech Stack

- **Runtime**: Deno
- **Framework**: Veryfront (React meta-framework)
- **Styling**: Tailwind CSS
- **Language**: TypeScript (strict mode)
- **AI**: Veryfront AI SDK, OpenAI

## Project Structure

```
src/
├── pages/          # File-based routing (index.tsx → /)
├── api/            # API endpoints (hello.ts → /api/hello)
├── components/     # React components
├── ai/             # AI agents and tools
└── styles/         # Global styles
```

## Conventions

- Use TypeScript strict mode
- Use React Server Components where possible
- Use `@veryfront/*` imports for framework utilities
- Co-locate tests with source files (`*.test.ts`)
- Keep components small and focused

## File Patterns

### Pages
```tsx
// src/pages/about.tsx → /about
export default function About() {
  return <h1>About</h1>;
}
```

### API Routes
```ts
// src/api/hello.ts → /api/hello
export function GET() {
  return Response.json({ message: "Hello" });
}
```

### Dynamic Routes
```ts
// src/api/users/[id].ts → /api/users/:id
export function GET(_req: Request, { params }: { params: { id: string } }) {
  return Response.json({ id: params.id });
}
```

## Available Commands

- `veryfront dev` - Start development server
- `veryfront build` - Production build
- `veryfront deploy` - Deploy to Veryfront cloud

## Current Tasks

See `docs/USER-STORIES.md` for features to implement.
