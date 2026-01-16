# demo-4lgsoi-3vpgss

Veryfront project using the "ai" template.

## Commands

| Command | Purpose |
|---------|---------|
| `veryfront dev` | Start development server |
| `veryfront build` | Production build |
| `veryfront deploy` | Deploy to Veryfront cloud |

## Structure

- `src/pages/` - Routes (file-based routing)
- `src/api/` - API endpoints
- `src/components/` - React components

## Patterns

### Add a page
Create `src/pages/name.tsx` → available at `/name`

### Add an API endpoint
Create `src/api/name.ts` → available at `/api/name`

### Add a component
Create `src/components/Name.tsx` → import with `@/components/Name`

## Current Tasks

See `docs/USER-STORIES.md` for features to implement.

## Testing

Co-locate tests with source files:
- `src/components/Button.tsx` → `src/components/Button.test.tsx`

Run tests with `deno test`.
