---
title: Hooks Guides
description: In-depth guides for using Veryfront's routing and navigation hooks
category: guides
keywords: [hooks, routing, navigation, use-router, use-params, use-pathname, use-search-params]
---

# Hooks Guides

Comprehensive guides for Veryfront's built-in hooks. These guides provide detailed examples, use cases, and best practices for each hook.

## Available Guides

### [useRouter](./use-router.md)
Access the router instance for programmatic navigation. Learn how to:
- Navigate to different routes programmatically
- Control navigation with push, replace, and back
- Handle navigation events and loading states
- Implement custom navigation flows

### [useParams](./use-params.md)
Access dynamic route parameters. Learn how to:
- Read URL parameters from dynamic routes
- Handle multiple route parameters
- Type-safe parameter access with TypeScript
- Use parameters for data fetching

### [usePathname](./use-pathname.md)
Access the current pathname. Learn how to:
- Get the current route path
- Implement breadcrumbs and navigation menus
- Show active states based on current path
- Track page views and analytics

### [useSearchParams](./use-search-params.md)
Read and manipulate URL search parameters. Learn how to:
- Read query parameters from the URL
- Update search params without full page reload
- Implement filtering, sorting, and pagination
- Preserve search params during navigation

## Prerequisites

Before using hooks, ensure you have:
- [Veryfront installed](/learn/installation.md) - Set up your development environment
- [Quick Start completed](/learn/quickstart.md) - Built your first application
- [Routing basics](/guides/routing/README.md) - Understand file-based routing
- **React knowledge** - Familiarity with React hooks

## Hook Guides

### Navigation Hooks
- [useRouter](./use-router.md) - Programmatic navigation and router control
- [usePathname](./use-pathname.md) - Access current pathname

### Route Data Hooks
- [useParams](./use-params.md) - Access dynamic route parameters
- [useSearchParams](./use-search-params.md) - Read and update query parameters

## Related Guides

### Routing & Navigation
- [Routing System](/guides/routing/README.md) - File-based routing overview
- [App Router](/guides/routing/app-router.md) - Modern routing with hooks
- [Dynamic Routes](/guides/routing/dynamic-routes.md) - URL parameters
- [Link Component](/guides/components/link.md) - Declarative navigation

### Components
- [Component Guides](/guides/components/README.md) - Built-in components
- [Link Component](/reference/components/link.md) - Link component reference

## Reference

### Hook API
- [Hooks API Reference](/reference/hooks/README.md) - Complete hook documentation
  - [useRouter API](/reference/hooks/use-router.md) - useRouter reference
  - [useParams API](/reference/hooks/use-params.md) - useParams reference
  - [usePathname API](/reference/hooks/use-pathname.md) - usePathname reference
  - [useSearchParams API](/reference/hooks/use-search-params.md) - useSearchParams reference

### Related APIs
- [Functions Reference](/reference/functions/README.md) - Server-side functions
- [Configuration](/reference/configuration/README.md) - Configure routing

## Common Patterns

### Navigation Pattern
```typescript
const router = useRouter();
router.push('/dashboard');
```

### Parameter Access Pattern
```typescript
const params = useParams();
const { slug } = params;
```

### Active Link Pattern
```typescript
const pathname = usePathname();
const isActive = pathname === '/about';
```

### Search Params Pattern
```typescript
const searchParams = useSearchParams();
const page = searchParams.get('page') || '1';
```

## Next Steps

- Explore individual hook guides above
- Check the [API Reference](/reference/hooks/README.md) for detailed documentation
- Learn about [routing patterns](/guides/routing/README.md)
- Build navigation with [Link component](/guides/components/link.md)
