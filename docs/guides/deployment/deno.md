---
title: "Deploy to Deno Deploy"
category: "deployment"
level: "beginner"
keywords: ["deno", "deployment", "production", "deno-deploy", "hosting"]
ai_summary: "Complete guide for deploying Veryfront applications to Deno Deploy with environment variables, custom domains, and CI/CD"
related: ["guides/deployment/node", "guides/deployment/bun", "api/configuration"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Deploy to Deno Deploy

Deploy your Veryfront application to [Deno Deploy](https://deno.com/deploy), the fastest way to run Deno applications at the edge globally.

## Why Deno Deploy?

- ⚡ **Lightning Fast** - Global edge network with sub-100ms cold starts
- 🌍 **Global CDN** - Deploy to 35+ regions worldwide automatically
- 💰 **Generous Free Tier** - 100k requests/day, 100 GB bandwidth/month free
- 🔒 **Secure** - Built-in permissions system, isolated execution
- 🎯 **Zero Config** - Works out of the box with Veryfront
- 🚀 **Instant Deploys** - Deploy in seconds with GitHub integration

**Perfect for:** Production apps, edge computing, serverless, global APIs

## Prerequisites

1. **Deno** installed locally ([Install Deno](https://deno.land/manual/getting_started/installation))
2. **Git** repository with your Veryfront app
3. **Deno Deploy account** (free) at [dash.deno.com](https://dash.deno.com)
4. **GitHub account** for automatic deployments (recommended)

## Quick Start (5 Minutes)

### 1. Prepare Your App

Ensure your `veryfront.config.ts` is configured for Deno:

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

export default defineConfig({
  runtime: 'deno', // This is the default
  projectName: 'my-app',
});
```

### 2. Test Locally

```bash
# Development mode
deno task dev

# Production build and test
deno task build
deno task start
```

### 3. Deploy to Deno Deploy

**Option A: Automatic GitHub Deployment (Recommended)**

1. Push your code to GitHub
2. Go to [dash.deno.com/new](https://dash.deno.com/new)
3. Connect your GitHub repository
4. Select your repository and branch
5. **Entry point:** `main.ts` or `src/main.ts`
6. Click "Deploy Project"

**Option B: Manual Deployment with CLI**

```bash
# Install deployctl
deno install --allow-read --allow-write --allow-env --allow-net --allow-run --no-check -r -f https://deno.land/x/deploy/deployctl.ts

# Deploy
deployctl deploy --project=my-app main.ts
```

**Option C: Drag & Drop (For Testing)**

1. Build your project locally: `deno task build`
2. Go to [dash.deno.com/new](https://dash.deno.com/new)
3. Choose "Drag & Drop"
4. Drag your `.veryfront/` directory

### 4. Your App is Live! 🎉

Visit `https://my-app.deno.dev` to see your deployed application.

---

## Configuration

### Project Structure

Veryfront apps on Deno Deploy follow this structure:

```
my-app/
├── app/                    # App Router (or pages/)
├── public/                 # Static assets
├── veryfront.config.ts     # Framework configuration
├── deno.json               # Deno configuration
├── main.ts                 # Entry point for Deno Deploy
└── .env                    # Environment variables (don't commit!)
```

### Entry Point (`main.ts`)

Veryfront automatically generates this file when you build:

```typescript
// main.ts
import { serve } from 'veryfront/server';
import config from './veryfront.config.ts';

// Start the server
serve(config);
```

Or create it manually for more control:

```typescript
// main.ts
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createVeryfrontHandler } from 'veryfront/server';
import config from './veryfront.config.ts';

const handler = await createVeryfrontHandler(config);

serve(handler, {
  port: 8000,
  onListen: ({ port }) => {
    console.log(`Server running on http://localhost:${port}`);
  },
});
```

### Deno Configuration (`deno.json`)

```json
{
  "tasks": {
    "dev": "deno run --allow-all --watch src/main.ts",
    "build": "veryfront build",
    "start": "deno run --allow-net --allow-read --allow-env main.ts"
  },
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "imports": {
    "veryfront": "jsr:@veryfront/core@^0.1.0",
    "veryfront/": "jsr:@veryfront/core@^0.1.0/",
    "react": "npm:react@^18.3.0",
    "react-dom": "npm:react-dom@^18.3.0",
    "react-dom/server": "npm:react-dom@^18.3.0/server"
  }
}
```

---

## Environment Variables

### Setting Environment Variables

**In Deno Deploy Dashboard:**
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add your variables (e.g., `DATABASE_URL`, `API_KEY`)
4. Click "Save"

**For Production:**
```
NODE_ENV=production
DATABASE_URL=postgres://user:pass@host:5432/db
API_KEY=your-secret-key
ANTHROPIC_API_KEY=sk-ant-...
```

### Accessing Environment Variables

```typescript
// Server-side only (getServerData, API routes)
const apiKey = Deno.env.get('API_KEY');
const dbUrl = Deno.env.get('DATABASE_URL');

// Or using process.env (compatible)
const apiKey = process.env.API_KEY;
```

### Environment Files

**Development (`.env`):**
```bash
# .env (local development only - don't commit!)
DATABASE_URL=postgres://localhost:5432/dev
API_KEY=dev-key-123
```

**Load in development:**
```typescript
// main.ts
import 'https://deno.land/std@0.208.0/dotenv/load.ts';

// Now process.env.API_KEY is available
```

---

## Custom Domains

### Add a Custom Domain

1. Go to your project settings in Deno Deploy
2. Navigate to "Domains"
3. Click "Add Domain"
4. Enter your domain (e.g., `app.example.com`)
5. Add the provided DNS records to your domain registrar

**DNS Configuration:**

```
Type: CNAME
Name: app (or @ for root domain)
Value: cname.deno.dev
```

### SSL/TLS Certificates

Deno Deploy automatically provisions and renews SSL certificates for all custom domains. No configuration needed!

---

## Continuous Deployment (CI/CD)

### Automatic Deployments with GitHub

Once connected to GitHub, Deno Deploy automatically:
- ✅ Deploys every push to your production branch
- ✅ Creates preview deployments for pull requests
- ✅ Rolls back on failure
- ✅ Shows deployment status in GitHub

**GitHub Actions Integration:**

```yaml
# .github/workflows/deploy.yml
name: Deploy to Deno Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: v1.x

      - name: Build
        run: deno task build

      - name: Deploy to Deno Deploy
        uses: denoland/deployctl@v1
        with:
          project: my-app
          entrypoint: main.ts
          root: .
```

---

## Database Integration

### Deno KV (Built-in)

Deno Deploy includes [Deno KV](https://deno.com/kv), a globally-replicated key-value database:

```typescript
// Open database
const kv = await Deno.openKv();

// Set a value
await kv.set(['users', userId], { name: 'John', email: 'john@example.com' });

// Get a value
const user = await kv.get(['users', userId]);
console.log(user.value); // { name: 'John', email: 'john@example.com' }

// List entries
const entries = kv.list({ prefix: ['users'] });
for await (const entry of entries) {
  console.log(entry.key, entry.value);
}
```

**Use cases:** Sessions, caching, feature flags, simple data storage

### External Databases

Connect to any database over HTTP/HTTPS:

**PostgreSQL (via Supabase):**
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_KEY')!
);

const { data, error } = await supabase
  .from('users')
  .select('*');
```

**MongoDB Atlas:**
```typescript
import { MongoClient } from 'https://deno.land/x/atlas_sdk/mod.ts';

const client = new MongoClient({
  endpoint: Deno.env.get('MONGO_URL')!,
  dataSource: 'Cluster0',
  auth: { apiKey: Deno.env.get('MONGO_API_KEY')! },
});

const users = client.database('mydb').collection('users');
const result = await users.findOne({ email: 'user@example.com' });
```

---

## Performance Optimization

### Edge Caching

Cache responses at the edge for lightning-fast performance:

```typescript
// API route with caching
export const GET = async (ctx) => {
  const data = await fetchData();

  return Response.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'CDN-Cache-Control': 'max-age=86400',
    },
  });
};
```

### Static Assets

Serve static assets from `public/` - automatically cached at the edge:

```
public/
├── images/
│   └── logo.png       → https://my-app.deno.dev/images/logo.png
├── styles/
│   └── global.css     → https://my-app.deno.dev/styles/global.css
└── favicon.ico        → https://my-app.deno.dev/favicon.ico
```

### Code Splitting

Veryfront automatically code-splits by route. For additional optimization:

```typescript
import dynamic from 'veryfront/dynamic';

const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
  loading: () => <p>Loading...</p>,
});
```

---

## Monitoring & Debugging

### View Logs

**In Dashboard:**
1. Go to your project
2. Click "Logs" tab
3. View real-time logs from all regions

**Via CLI:**
```bash
deployctl logs --project=my-app
```

### Console Logging

```typescript
// Logs appear in Deno Deploy dashboard
console.log('User logged in:', userId);
console.error('Failed to fetch data:', error);
console.warn('Deprecated API called');
```

### Error Tracking

Integrate with error tracking services:

```typescript
// Integrate Sentry
import * as Sentry from 'https://deno.land/x/sentry/index.ts';

Sentry.init({
  dsn: Deno.env.get('SENTRY_DSN'),
  environment: 'production',
});

// In your error boundary or API routes
try {
  await riskyOperation();
} catch (error) {
  Sentry.captureException(error);
  throw error;
}
```

---

## Scaling & Performance

### Automatic Scaling

Deno Deploy automatically scales your application:
- **Horizontal scaling** - Automatically adds instances
- **Global distribution** - Deploys to 35+ regions
- **Zero config** - No manual scaling needed

### Performance Limits

**Free Tier:**
- 100k requests/day
- 100 GB bandwidth/month
- 100 ms CPU time per request
- 128 MB memory per isolate

**Pro Tier ($20/month):**
- 10M requests/month
- 100 GB bandwidth/month
- Unlimited projects
- Custom domains

**Enterprise:**
- Unlimited requests
- Dedicated support
- SLA guarantees
- Custom pricing

### Optimize for Edge

**✅ Do:**
- Use async/await for I/O operations
- Cache frequently accessed data
- Minimize external API calls
- Use Deno KV for session storage
- Leverage edge caching headers

**❌ Don't:**
- Use CPU-intensive operations (image processing, video encoding)
- Store large files in memory
- Make synchronous blocking calls
- Use WebSockets (use Server-Sent Events instead)

---

## Security Best Practices

### 1. Environment Variables

```typescript
// ❌ Don't hardcode secrets
const API_KEY = 'sk-secret-key';

// ✅ Use environment variables
const API_KEY = Deno.env.get('API_KEY');
```

### 2. Permissions

Deno Deploy runs with these permissions by default:
- `--allow-net` - Network access
- `--allow-read` - Read files (within project)
- `--allow-env` - Access environment variables

**You cannot:**
- Write files (use Deno KV or external storage)
- Execute subprocesses
- Access FFI

### 3. CORS

```typescript
// API route with CORS
export const GET = async (ctx) => {
  return Response.json({ data }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
};
```

### 4. Rate Limiting

Use Deno KV for distributed rate limiting:

```typescript
async function rateLimit(userId: string): Promise<boolean> {
  const kv = await Deno.openKv();
  const key = ['ratelimit', userId, Date.now() / 60000 | 0];

  const count = await kv.get(key);
  if (count.value && count.value >= 100) {
    return false; // Rate limit exceeded
  }

  await kv.atomic()
    .set(key, (count.value || 0) + 1, { expireIn: 60000 })
    .commit();

  return true;
}
```

---

## Troubleshooting

### Common Issues

**1. "Module not found"**

Solution: Use JSR or HTTP imports:
```typescript
// ❌ Don't use npm imports
import { something } from 'some-package';

// ✅ Use JSR or CDN
import { something } from 'jsr:@scope/package';
import { something } from 'https://esm.sh/package';
```

**2. "Permission denied"**

Solution: Check Deno Deploy permissions - file write is not allowed. Use Deno KV or external storage.

**3. "Request timeout"**

Solution: Optimize slow operations:
- Use async/await
- Cache results
- Reduce external API calls
- Consider moving CPU-intensive work elsewhere

**4. "Cold start latency"**

Solution:
- Minimize dependencies
- Use dynamic imports for heavy components
- Keep main bundle small (<1 MB)

**5. "Environment variable not found"**

Solution: Set in Deno Deploy dashboard under Settings → Environment Variables

---

## Migration from Other Platforms

### From Vercel/Netlify

1. **Change entry point:**
   ```typescript
   // From Next.js server
   // To: main.ts with Veryfront serve()
   ```

2. **Update environment variables:**
   - Export from Vercel/Netlify
   - Import to Deno Deploy dashboard

3. **Update dependencies:**
   ```typescript
   // From npm imports
   import { x } from 'package';

   // To JSR or HTTP imports
   import { x } from 'jsr:@scope/package';
   ```

### From Deno Deploy (Pure)

If migrating from standalone Deno Deploy:

1. Install Veryfront: `deno add @veryfront/core`
2. Create `veryfront.config.ts`
3. Move routes to `app/` or `pages/`
4. Update `main.ts` to use Veryfront server

---

## Production Checklist

Before going live:

- [ ] Test locally with `deno task build && deno task start`
- [ ] Set all environment variables in Deno Deploy
- [ ] Configure custom domain and verify DNS
- [ ] Enable automatic deployments from GitHub
- [ ] Set up error tracking (Sentry, LogRocket)
- [ ] Configure caching headers for static assets
- [ ] Test from multiple regions
- [ ] Set up monitoring and alerts
- [ ] Review security settings (CORS, rate limiting)
- [ ] Test database connections and queries
- [ ] Verify SSL certificate is active

---

## Cost Estimation

### Free Tier (Good for)
- Personal projects
- Side projects
- Portfolio sites
- < 3k daily visitors

### Pro Tier $20/month (Good for)
- Small businesses
- SaaS applications
- < 300k daily visitors

### Enterprise (Contact sales)
- High-traffic applications
- > 300k daily visitors
- Custom SLA requirements

---

## Examples

**Deploy a Blog:**
```bash
# 1. Create Veryfront blog
deno init --template=veryfront-blog my-blog
cd my-blog

# 2. Test locally
deno task dev

# 3. Push to GitHub
git init && git add . && git commit -m "Initial commit"
gh repo create my-blog --public --push

# 4. Deploy on Deno Deploy
# → Connect GitHub repo at dash.deno.com
```

**Deploy an API:**
```typescript
// app/api/hello/route.ts
export const GET = () => {
  return Response.json({ message: 'Hello from Deno Deploy!' });
};

// Deploy: Push to GitHub, auto-deploys
// Access: https://my-app.deno.dev/api/hello
```

---

## Next Steps

- **Monitor Performance:** Check analytics in Deno Deploy dashboard
- **Add Custom Domain:** [Custom domains documentation](https://docs.deno.com/deploy/manual/custom-domains)
- **Scale to Pro:** Upgrade when you exceed free tier limits
- **Explore Deno KV:** [Deno KV documentation](https://docs.deno.com/kv/manual)

## Related Documentation

- [Node.js Deployment](./node.md) - Deploy to Vercel, Railway
- [Bun Deployment](./bun.md) - Deploy with Bun runtime
- [Configuration](..//reference/functions/configuration.md) - Framework configuration
- [Environment Variables](./env-vars.md) - Managing secrets

## Getting Help

- **Deno Deploy Docs:** [docs.deno.com/deploy](https://docs.deno.com/deploy)
- **Deno Discord:** [discord.gg/deno](https://discord.gg/deno)
- **Veryfront Issues:** Report bugs on GitHub
- **Examples:** Check `/examples/` directory

---

**Congratulations!** 🎉 Your Veryfront app is now running on Deno Deploy's global edge network.
