# Veryfront RSC Demo

This example demonstrates Veryfront's minimal React Server Components
implementation.

## Features Demonstrated

1. **Server Components** - The main page component runs on the server
2. **Client Components** - Interactive counter component with `'use client'`
3. **Data Fetching** - Direct async data fetching in server components
4. **Component Boundaries** - Automatic serialization at boundaries

## Running the Demo

1. Enable RSC feature flag:
   ```bash
   export VERYFRONT_ENABLE_RSC=true
   ```

2. Start the dev server from this directory:
   ```bash
   cd examples/rsc-demo
   deno task dev
   ```

3. Open http://localhost:3002/_veryfront/rsc/page

## How It Works

1. **Server Rendering**: The `page.tsx` component runs on the server, fetches
   data, and renders HTML
2. **Client Boundaries**: When the server renderer encounters `ClientCounter`,
   it creates a placeholder
3. **Hydration**: The client loads the counter component and hydrates the
   placeholder
4. **Interactivity**: The counter works with full React state management

## File Structure

```
app/
├── page.tsx                 # Server component (default)
└── ClientCounter.client.tsx # Client component (interactive)
```

## Key Concepts

- Components are server components by default
- Add `'use client'` directive to make a component run on the client
- Server components can be async and fetch data directly
- Client components handle all interactivity
- Props are automatically serialized at component boundaries

## Benefits

- **Smaller Bundles**: Server components don't add to client JavaScript
- **Better Performance**: Less JavaScript to parse and execute
- **Simpler Data Fetching**: No need for useEffect or data fetching libraries
- **Security**: Keep sensitive logic on the server

## Limitations

This is a minimal implementation focused on core RSC features:

- No streaming (full payload sent at once)
- Basic error handling
- No server actions yet
- Simple JSON serialization

Despite these limitations, it provides the core benefits of RSC with just ~750
lines of code!
