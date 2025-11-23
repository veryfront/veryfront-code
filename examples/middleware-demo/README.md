# Middleware Demo

This example demonstrates how to use custom and built-in middleware in Veryfront.

## Features

- **Rate Limiting**: Protects the app from abuse (10 requests/window).
- **Logger Middleware**: Logs every request and response time.
- **Auth Guard Middleware**: Protects `/protected` route requiring a Bearer token.

## Run

```bash
deno task dev
```

## Testing

1. **Public Route (Rate Limited):**
   Open http://localhost:3000
   Refresh 10 times quickly. You should see "Too Many Requests".

2. **Protected Route (Unauthorized):**
   Open http://localhost:3000/protected
   Should see "Unauthorized".

3. **Protected Route (Authorized):**
   ```bash
   curl -H "Authorization: Bearer secret" http://localhost:3000/protected
   ```
   Should receive 200 OK.
