---
title: Script Component
description: Load and optimize third-party scripts with control over loading strategies in Veryfront
keywords:
  - script component
  - third-party scripts
  - analytics
  - loading strategies
  - defer
  - async
  - beforeInteractive
  - afterInteractive
  - performance
related:
  - /docs/components/head.md
  - /docs/components/image.md
  - /docs/guides/performance/optimization.md
  - /guides/rendering/ssr.md
---

# Script Component

The `Script` component provides optimized loading of third-party scripts with control over when and how they execute. It helps improve performance by strategically loading scripts based on your application's needs.

## Overview

The Script component in Veryfront provides:

- **Loading Strategies**: Control when scripts load (before/after interactive, lazy)
- **Performance Optimization**: Defer non-critical scripts for better Core Web Vitals
- **Inline Scripts**: Support for inline JavaScript with CSP nonce
- **Event Callbacks**: onLoad, onReady, and onError handlers
- **TypeScript Support**: Full type safety for all props

## Loading Strategies

### beforeInteractive

Load critical scripts before the page becomes interactive. Use for scripts that must run early (like polyfills or critical features).

```tsx
import { Script } from 'veryfront';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Loads before page becomes interactive */}
        <Script
          src="https://polyfill.io/v3/polyfill.min.js"
          strategy="beforeInteractive"
        />

        {children}
      </body>
    </html>
  );
}
```

### afterInteractive (Default)

Load scripts after the page becomes interactive. Best for analytics, ads, and non-critical features.

```tsx
import { Script } from 'veryfront';

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Loads after page is interactive (default) */}
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=GA-XXXXX"
        strategy="afterInteractive"
      />

      <Script
        id="google-analytics"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'GA-XXXXX');
          `
        }}
      />

      {children}
    </>
  );
}
```

### lazyOnload

Lazy load scripts during idle time. Use for non-essential features like chat widgets or social media embeds.

```tsx
import { Script } from 'veryfront';

export default function ChatWidget() {
  return (
    <>
      {/* Loads during browser idle time */}
      <Script
        src="https://widget.intercom.io/widget/YOUR-APP-ID"
        strategy="lazyOnload"
      />

      <div>Your page content...</div>
    </>
  );
}
```

### worker

Load scripts in a Web Worker (experimental). Use for expensive computations that shouldn't block the main thread.

```tsx
import { Script } from 'veryfront';

export default function WorkerExample() {
  return (
    <Script
      src="/heavy-computation.js"
      strategy="worker"
    />
  );
}
```

## Basic Usage

### External Script

```tsx
import { Script } from 'veryfront';

export default function ExternalScript() {
  return (
    <>
      <Script src="https://example.com/script.js" />
      <div>Your content...</div>
    </>
  );
}
```

### Inline Script

```tsx
import { Script } from 'veryfront';

export default function InlineScript() {
  return (
    <>
      <Script
        id="inline-script"
        dangerouslySetInnerHTML={{
          __html: `
            console.log('Script loaded');
            window.myGlobal = 'value';
          `
        }}
      />
      <div>Your content...</div>
    </>
  );
}
```

## Event Handlers

### onLoad

Executes when the script has loaded successfully:

```tsx
import { Script } from 'veryfront';

export default function ScriptWithOnLoad() {
  return (
    <Script
      src="https://example.com/library.js"
      onLoad={() => {
        console.log('Script loaded successfully');
        // Initialize library
        window.myLibrary.init();
      }}
    />
  );
}
```

### onReady

Executes when the script is ready to use (after first load and on subsequent navigations):

```tsx
import { Script } from 'veryfront';

export default function ScriptWithOnReady() {
  return (
    <Script
      src="https://example.com/library.js"
      onReady={() => {
        console.log('Script ready to use');
        // Safe to use library
        window.myLibrary.doSomething();
      }}
    />
  );
}
```

### onError

Handles script loading errors:

```tsx
'use client';

import { Script } from 'veryfront';
import { useState } from 'react';

export default function ScriptWithErrorHandling() {
  const [scriptError, setScriptError] = useState(false);

  return (
    <>
      <Script
        src="https://example.com/library.js"
        onError={() => {
          console.error('Script failed to load');
          setScriptError(true);
        }}
      />

      {scriptError && (
        <div className="error">
          Failed to load external library. Some features may not work.
        </div>
      )}
    </>
  );
}
```

## Common Integrations

### Google Analytics

```tsx
import { Script } from 'veryfront';

export default function GoogleAnalytics() {
  const GA_ID = 'G-XXXXXXXXXX';

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />

      <Script
        id="google-analytics"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
          `
        }}
      />
    </>
  );
}
```

### Google Tag Manager

```tsx
import { Script } from 'veryfront';

export default function GoogleTagManager() {
  const GTM_ID = 'GTM-XXXXXXX';

  return (
    <>
      <Script
        id="google-tag-manager"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${GTM_ID}');
          `
        }}
      />

      {/* GTM noscript fallback goes in <body> */}
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
        />
      </noscript>
    </>
  );
}
```

### Facebook Pixel

```tsx
import { Script } from 'veryfront';

export default function FacebookPixel() {
  const PIXEL_ID = 'YOUR_PIXEL_ID';

  return (
    <>
      <Script
        id="facebook-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${PIXEL_ID}');
            fbq('track', 'PageView');
          `
        }}
      />

      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
```

### Stripe

```tsx
'use client';

import { Script } from 'veryfront';
import { useState } from 'react';

export default function StripePayment() {
  const [stripeLoaded, setStripeLoaded] = useState(false);

  return (
    <>
      <Script
        src="https://js.stripe.com/v3/"
        onLoad={() => {
          setStripeLoaded(true);
          console.log('Stripe.js loaded');
        }}
      />

      {stripeLoaded && (
        <div>
          {/* Render payment form */}
          <button onClick={() => {
            const stripe = window.Stripe('pk_test_...');
            // Initialize payment
          }}>
            Pay Now
          </button>
        </div>
      )}
    </>
  );
}
```

### Intercom Chat Widget

```tsx
import { Script } from 'veryfront';

export default function IntercomWidget() {
  const APP_ID = 'YOUR_APP_ID';

  return (
    <>
      <Script
        id="intercom-settings"
        strategy="lazyOnload"
        dangerouslySetInnerHTML={{
          __html: `
            window.intercomSettings = {
              app_id: "${APP_ID}",
              custom_launcher_selector: '#intercom-launcher'
            };
          `
        }}
      />

      <Script
        src={`https://widget.intercom.io/widget/${APP_ID}`}
        strategy="lazyOnload"
      />
    </>
  );
}
```

### Twitter/X Widgets

```tsx
import { Script } from 'veryfront';

export default function TwitterWidgets() {
  return (
    <>
      <Script
        src="https://platform.twitter.com/widgets.js"
        strategy="lazyOnload"
      />

      <div>
        <a
          className="twitter-timeline"
          data-width="400"
          data-height="600"
          href="https://twitter.com/YourUsername?ref_src=twsrc%5Etfw"
        >
          Tweets by YourUsername
        </a>
      </div>
    </>
  );
}
```

## Advanced Patterns

### Conditional Script Loading

```tsx
'use client';

import { Script } from 'veryfront';

export default function ConditionalScript({ enableAnalytics }: { enableAnalytics: boolean }) {
  if (!enableAnalytics) {
    return null;
  }

  return (
    <Script
      src="https://www.googletagmanager.com/gtag/js?id=GA-XXXXX"
      strategy="afterInteractive"
    />
  );
}
```

### Script with CSP Nonce

```tsx
import { Script } from 'veryfront';

export default function ScriptWithNonce({ nonce }: { nonce: string }) {
  return (
    <Script
      id="inline-script"
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: `
          console.log('Script with CSP nonce');
        `
      }}
    />
  );
}
```

### Multiple Scripts with Dependencies

```tsx
'use client';

import { Script } from 'veryfront';
import { useState } from 'react';

export default function DependentScripts() {
  const [jqueryLoaded, setJqueryLoaded] = useState(false);

  return (
    <>
      {/* Load jQuery first */}
      <Script
        src="https://code.jquery.com/jquery-3.6.0.min.js"
        strategy="afterInteractive"
        onLoad={() => setJqueryLoaded(true)}
      />

      {/* Load jQuery plugin after jQuery loads */}
      {jqueryLoaded && (
        <Script
          src="https://cdn.example.com/jquery-plugin.js"
          strategy="afterInteractive"
        />
      )}
    </>
  );
}
```

### Reusable Analytics Component

```tsx
import { Script } from 'veryfront';

interface AnalyticsProps {
  googleAnalyticsId?: string;
  facebookPixelId?: string;
}

export function Analytics({
  googleAnalyticsId,
  facebookPixelId,
  mixpanelToken
}: AnalyticsProps) {
  return (
    <>
      {/* Google Analytics */}
      {googleAnalyticsId && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`}
            strategy="afterInteractive"
          />
          <Script
            id="google-analytics"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${googleAnalyticsId}');
              `
            }}
          />
        </>
      )}

      {/* Facebook Pixel */}
      {facebookPixelId && (
        <Script
          id="facebook-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${facebookPixelId}');
              fbq('track', 'PageView');
            `
          }}
        />
      )}

    </>
  );
}

// Usage:
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Analytics
          googleAnalyticsId="G-XXXXXXXXXX"
          facebookPixelId="XXXXXXXXXX"
        />
        {children}
      </body>
    </html>
  );
}
```

## TypeScript Support

### Type-Safe Script Props

```tsx
import { Script } from 'veryfront';
import type { ComponentProps } from 'react';

type ScriptProps = ComponentProps<typeof Script>;

interface ExternalScriptProps extends Omit<ScriptProps, 'src'> {
  src: string;
  fallback?: React.ReactNode;
}

export function ExternalScript({
  src,
  fallback,
  ...props
}: ExternalScriptProps) {
  const [error, setError] = useState(false);

  if (error && fallback) {
    return <>{fallback}</>;
  }

  return (
    <Script
      src={src}
      onError={() => setError(true)}
      {...props}
    />
  );
}
```

### Typed Analytics Integration

```tsx
import { Script } from 'veryfront';

interface GoogleAnalyticsProps {
  measurementId: string;
  config?: {
    send_page_view?: boolean;
    anonymize_ip?: boolean;
    cookie_flags?: string;
  };
}

export function GoogleAnalytics({
  measurementId,
  config = {}
}: GoogleAnalyticsProps) {
  const configString = Object.entries(config)
    .map(([key, value]) => `'${key}': ${JSON.stringify(value)}`)
    .join(', ');

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />

      <Script
        id="google-analytics"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${measurementId}', { ${configString} });
          `
        }}
      />
    </>
  );
}
```

## Best Practices

### 1. Choose the Right Strategy

```tsx
// ❌ Bad: Loading chat widget before page is interactive
<Script src="https://widget.com/chat.js" strategy="beforeInteractive" />

// ✅ Good: Lazy load non-critical widgets
<Script src="https://widget.com/chat.js" strategy="lazyOnload" />
```

### 2. Use Event Handlers for Dependencies

```tsx
// ❌ Bad: Assuming script is loaded
<Script src="https://example.com/library.js" />
<script>window.library.init();</script>  {/* May fail! */}

// ✅ Good: Initialize in onLoad callback
<Script
  src="https://example.com/library.js"
  onLoad={() => {
    window.library.init();
  }}
/>
```

### 3. Provide ID for Inline Scripts

```tsx
// ❌ Bad: No ID for inline script
<Script dangerouslySetInnerHTML={{ __html: 'console.log("test")' }} />

// ✅ Good: Always provide ID
<Script
  id="my-inline-script"
  dangerouslySetInnerHTML={{ __html: 'console.log("test")' }}
/>
```

### 4. Handle Loading Errors

```tsx
// ❌ Bad: No error handling
<Script src="https://example.com/script.js" />

// ✅ Good: Handle errors gracefully
<Script
  src="https://example.com/script.js"
  onError={() => {
    console.error('Failed to load script');
    // Provide fallback functionality
  }}
/>
```

### 5. Avoid Blocking Scripts

```tsx
// ❌ Bad: Synchronous third-party script
<script src="https://example.com/heavy-script.js"></script>

// ✅ Good: Use Script component with appropriate strategy
<Script
  src="https://example.com/heavy-script.js"
  strategy="afterInteractive"
/>
```

### 6. Use CSP Nonce for Inline Scripts

```tsx
// ❌ Bad: Inline script without nonce (CSP violation)
<Script id="analytics" dangerouslySetInnerHTML={{ __html: '...' }} />

// ✅ Good: Include nonce for CSP compliance
<Script
  id="analytics"
  nonce={cspNonce}
  dangerouslySetInnerHTML={{ __html: '...' }}
/>
```

## Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | - | External script URL |
| `strategy` | `'beforeInteractive' \| 'afterInteractive' \| 'lazyOnload' \| 'worker'` | `'afterInteractive'` | Loading strategy |
| `id` | `string` | - | Unique identifier (required for inline scripts) |
| `onLoad` | `() => void` | - | Callback when script loads |
| `onReady` | `() => void` | - | Callback when script is ready |
| `onError` | `() => void` | - | Callback on loading error |
| `dangerouslySetInnerHTML` | `{ __html: string }` | - | Inline script content |
| `nonce` | `string` | - | CSP nonce for inline scripts |
| `async` | `boolean` | - | Load script asynchronously |
| `defer` | `boolean` | - | Defer script execution |

## Performance Tips

### 1. Minimize Third-Party Scripts

Only load essential third-party scripts. Each script adds overhead.

### 2. Use Appropriate Loading Strategy

- `beforeInteractive`: Only for critical scripts (polyfills, feature detection)
- `afterInteractive`: For analytics and tracking (default)
- `lazyOnload`: For non-essential features (chat, social widgets)

### 3. Self-Host When Possible

Self-hosting scripts reduces external dependencies and improves reliability:

```tsx
// Instead of:
<Script src="https://cdn.example.com/library.js" />

// Consider:
<Script src="/static/library.js" />
```

### 4. Monitor Script Impact

Use Chrome DevTools or Lighthouse to measure the performance impact of third-party scripts.

## Next Steps

- Learn about [Head component](/docs/components/head.md) for metadata management
- Explore [Performance optimization](/docs/guides/performance/optimization.md) for more tips
- Check out [Image component](/docs/components/image.md) for image optimization
- Read about [SSR](/guides/rendering/ssr.md) for server-side rendering
