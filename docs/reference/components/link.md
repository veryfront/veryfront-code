---
title: Link
description: Client-side navigation component for seamless page transitions without full page reloads
category: reference
type: component
keywords: [link, navigation, routing, client-side, prefetch]
related: [/reference/hooks/use-router.md, /reference/hooks/use-pathname.md]
---

# Link

Client-side navigation component for seamless page transitions without full page reloads.

## Syntax

```typescript
import { Link } from 'veryfront';

<Link href="/path">Content</Link>
```

## Props

| Name | Type | Required | Description |
|------|------|----------|-------------|
| href | string | Yes | Destination URL for navigation |
| prefetch | boolean | No | Prefetch the page on hover for faster navigation (default: false) |
| replace | boolean | No | Replace current history entry instead of pushing a new one (default: false) |
| scroll | boolean | No | Scroll to top of page after navigation (default: true) |
| className | string | No | CSS class name to apply to the link element |
| children | React.ReactNode | Yes | Content to render inside the link |

## Return Value

Returns a React element that renders as an anchor (`<a>`) tag with enhanced client-side navigation.

## Examples

### Basic Usage

```typescript
import { Link } from 'veryfront';

export default function Navigation() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/about">About</Link>
      <Link href="/contact">Contact</Link>
    </nav>
  );
}
```

### With Prefetching

Prefetch pages on hover for instant navigation:

```typescript
import { Link } from 'veryfront';

export default function BlogList({ posts }) {
  return (
    <div>
      {posts.map(post => (
        <Link
          key={post.id}
          href={`/blog/${post.slug}`}
          prefetch={true}
        >
          {post.title}
        </Link>
      ))}
    </div>
  );
}
```

### Replace History

Replace the current history entry instead of adding a new one:

```typescript
import { Link } from 'veryfront';

export default function LoginRedirect() {
  return (
    <Link href="/dashboard" replace={true}>
      Go to Dashboard (replaces history)
    </Link>
  );
}
```

### Disable Scroll to Top

Prevent automatic scrolling to the top of the page:

```typescript
import { Link } from 'veryfront';

export default function TabNavigation() {
  return (
    <div>
      <Link href="/profile#settings" scroll={false}>
        Settings
      </Link>
      <Link href="/profile#preferences" scroll={false}>
        Preferences
      </Link>
    </div>
  );
}
```

### With Custom Styling

```typescript
import { Link } from 'veryfront';

export default function StyledLink() {
  return (
    <Link
      href="/premium"
      className="text-blue-600 hover:text-blue-800 underline"
    >
      Upgrade to Premium
    </Link>
  );
}
```

### Dynamic Routes

```typescript
import { Link } from 'veryfront';

export default function UserList({ users }) {
  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>
          <Link href={`/users/${user.id}`}>
            {user.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

## Behavior

- **Client-side navigation**: Uses the History API to navigate without full page reloads
- **Prefetching**: When `prefetch={true}`, the page is loaded in the background on hover
- **Automatic optimization**: Links to external domains render as normal `<a>` tags
- **Scroll restoration**: Maintains scroll position when using browser back/forward buttons
- **Accessibility**: Renders semantic HTML with proper anchor tags

## Notes

- The `Link` component automatically detects external URLs and renders them as standard anchor tags
- Prefetching only works for internal routes and requires client-side JavaScript
- For programmatic navigation, use the `useRouter` hook instead
- Links are crawlable by search engines as they render as standard `<a>` tags in HTML

## Related

- [useRouter](/reference/hooks/use-router.md) - Programmatic navigation hook
- [usePathname](/reference/hooks/use-pathname.md) - Get current pathname
- [useParams](/reference/hooks/use-params.md) - Access route parameters
