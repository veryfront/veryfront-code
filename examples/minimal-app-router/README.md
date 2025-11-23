# Minimal App Router Example

A tiny App Router app demonstrating a root page and a nested segment with
loading/error components.

## Structure

- `app/page.tsx` – Root page (`/`)
- `app/docs/page.tsx` – Nested page (`/docs`)
- `app/docs/loading.tsx` – Streaming loading UI
- `app/docs/error.tsx` – Error boundary UI
- `app/api/echo/route.ts` – Simple API route

## Run (dev)

```bash
veryfront dev
```

## Run (production server)

```bash
veryfront serve --port 3000
```

Then open http://127.0.0.1:3000 and http://127.0.0.1:3000/api/echo.
