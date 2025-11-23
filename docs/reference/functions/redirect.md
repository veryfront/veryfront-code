---
title: redirect
description: Perform server-side redirects from data fetching functions with support for temporary and permanent redirects
category: reference
type: function
keywords: [redirect, navigation, server-side, 301, 302]
related: [/reference/functions/get-server-data.md, /reference/functions/not-found.md, /reference/hooks/use-router.md]
---

# redirect

Perform server-side redirects from data fetching functions with support for temporary (302) and permanent (301) redirects.

## Syntax

```typescript
import { redirect } from 'veryfront';

export const getServerData = async (ctx) => {
  const user = await getUser(ctx.request);

  if (!user) {
    return redirect('/login');
  }

  return { props: { user } };
};
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| destination | string | Yes | URL to redirect to (absolute or relative) |
| options | RedirectOptions | No | Redirect configuration options |

### RedirectOptions

```typescript
interface RedirectOptions {
  permanent?: boolean;  // true for 301, false for 302 (default: false)
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| permanent | boolean | false | Use 301 (permanent) instead of 302 (temporary) redirect |

## Return Value

Returns an object that signals Veryfront to perform a redirect:

```typescript
{
  redirect: {
    destination: string;
    permanent: boolean;
  }
}
```

## Examples

### Basic Redirect

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const user = await getUser(ctx.request);

  if (!user) {
    return redirect('/login');
  }

  return {
    props: {
      user
    }
  };
};

export default function DashboardPage({ user }) {
  return (
    <div>
      <h1>Welcome, {user.name}</h1>
    </div>
  );
}
```

### Permanent Redirect (301)

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ oldSlug: string }>) => {
  const { oldSlug } = ctx.params;

  // Get new URL for old slug
  const newSlug = await getNewSlug(oldSlug);

  if (newSlug) {
    return redirect(`/blog/${newSlug}`, { permanent: true });
  }

  return { notFound: true };
};
```

### Conditional Redirect Based on User Role

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const user = await getUser(ctx.request);

  if (!user) {
    return redirect('/login');
  }

  if (user.role !== 'admin') {
    return redirect('/unauthorized');
  }

  return {
    props: {
      user
    }
  };
};

export default function AdminPage({ user }) {
  return <div>Admin Dashboard</div>;
}
```

### Redirect with Query Parameters

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const user = await getUser(ctx.request);

  if (!user) {
    // Redirect to login with return URL
    const returnUrl = ctx.url.pathname;
    return redirect(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  return {
    props: {
      user
    }
  };
};
```

### Redirect Based on Subdomain

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const host = ctx.headers.get('host') || '';

  // Redirect www to non-www
  if (host.startsWith('www.')) {
    const newHost = host.replace('www.', '');
    return redirect(`https://${newHost}${ctx.url.pathname}`, {
      permanent: true
    });
  }

  return {
    props: {
      data: 'content'
    }
  };
};
```

### Locale-Based Redirect

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const acceptLanguage = ctx.headers.get('accept-language') || '';

  // Detect preferred language
  const preferredLang = acceptLanguage.split(',')[0].split('-')[0];

  // Redirect to localized version
  const supportedLanguages = ['en', 'es', 'fr', 'de'];
  if (supportedLanguages.includes(preferredLang)) {
    return redirect(`/${preferredLang}${ctx.url.pathname}`);
  }

  return {
    props: {
      content: 'default content'
    }
  };
};
```

### Redirect After Form Submission

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  // Check if this is a POST request with form data
  if (ctx.request.method === 'POST') {
    const formData = await ctx.request.formData();
    const success = await processForm(formData);

    if (success) {
      return redirect('/success');
    }
  }

  return {
    props: {
      form: {}
    }
  };
};
```

### Maintenance Mode Redirect

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const MAINTENANCE_WHITELIST = ['/maintenance', '/admin'];

export const getServerData = async (ctx: DataContext) => {
  if (MAINTENANCE_MODE && !MAINTENANCE_WHITELIST.includes(ctx.url.pathname)) {
    return redirect('/maintenance');
  }

  return {
    props: {
      data: 'content'
    }
  };
};
```

### Mobile/Desktop Redirect

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const userAgent = ctx.headers.get('user-agent') || '';
  const isMobile = /mobile/i.test(userAgent);

  // Redirect mobile users to mobile site
  if (isMobile && !ctx.url.hostname.startsWith('m.')) {
    return redirect(`https://m.${ctx.url.hostname}${ctx.url.pathname}`);
  }

  return {
    props: {
      content: 'desktop content'
    }
  };
};
```

### Trailing Slash Redirect

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const { pathname } = ctx.url;

  // Add trailing slash if missing
  if (!pathname.endsWith('/') && !pathname.includes('.')) {
    return redirect(`${pathname}/${ctx.url.search}`, {
      permanent: true
    });
  }

  return {
    props: {
      data: 'content'
    }
  };
};
```

### A/B Test Redirect

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const cookie = ctx.headers.get('cookie') || '';
  const hasVariantCookie = cookie.includes('ab-test-variant');

  if (!hasVariantCookie) {
    // Randomly assign variant
    const variant = Math.random() < 0.5 ? 'a' : 'b';
    return redirect(`/experiment/${variant}`);
  }

  return {
    props: {
      data: 'content'
    }
  };
};
```

### Redirect with Preserving Query String

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ oldPath: string }>) => {
  const { oldPath } = ctx.params;
  const newPath = await getNewPath(oldPath);

  // Preserve query string in redirect
  const queryString = ctx.url.search;

  return redirect(`${newPath}${queryString}`, {
    permanent: true
  });
};
```

### External Redirect

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ shortCode: string }>) => {
  const { shortCode } = ctx.params;

  // Fetch long URL from database
  const url = await getUrlByShortCode(shortCode);

  if (!url) {
    return { notFound: true };
  }

  // Redirect to external URL
  return redirect(url.longUrl);
};
```

### Inline Return

You can also return the redirect object directly without using the `redirect()` helper:

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const user = await getUser(ctx.request);

  if (!user) {
    return {
      redirect: {
        destination: '/login',
        permanent: false
      }
    };
  }

  return {
    props: {
      user
    }
  };
};
```

### Multiple Redirect Conditions

```typescript
import { redirect } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const { id } = ctx.params;

  // Check if ID is valid
  if (!/^\d+$/.test(id)) {
    return redirect('/');
  }

  const resource = await fetchResource(id);

  if (!resource) {
    return { notFound: true };
  }

  // Redirect if resource has moved
  if (resource.redirectTo) {
    return redirect(resource.redirectTo, { permanent: true });
  }

  // Redirect if resource requires premium
  if (resource.requiresPremium) {
    const user = await getUser(ctx.request);
    if (!user?.isPremium) {
      return redirect('/upgrade');
    }
  }

  return {
    props: {
      resource
    }
  };
};
```

## Behavior

- **HTTP status codes**: Returns 302 (temporary) by default, or 301 with `permanent: true`
- **Server-side only**: Executes before rendering, saves client-side JavaScript
- **SEO friendly**: Search engines recognize and follow redirects properly
- **Preserves method**: POST redirects become GET (standard HTTP behavior)

## HTTP Status Codes

| Permanent | Status Code | Description |
|-----------|-------------|-------------|
| false | 302 | Temporary redirect (default) |
| true | 301 | Permanent redirect |

### When to Use Each

**Temporary (302):**
- Authentication redirects
- Conditional redirects (A/B tests, locale detection)
- Maintenance mode
- Temporary content moves

**Permanent (301):**
- URL restructuring
- Content permanently moved
- www to non-www redirects
- Old slugs to new slugs

## Notes

- Only works in server-side context (`getServerData`, `getStaticPaths`)
- Cannot be used in client components (use `useRouter` instead)
- The `redirect()` helper is a convenience wrapper
- Both relative and absolute URLs are supported
- Preserves query strings if included in destination
- For client-side navigation, use the `useRouter` hook

## Related

- [getServerData](/reference/functions/get-server-data.md) - Server-side data fetching
- [notFound](/reference/functions/not-found.md) - Return 404 response
- [useRouter](/reference/hooks/use-router.md) - Client-side navigation
- [Link](/reference/components/link.md) - Declarative navigation
