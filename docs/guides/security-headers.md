---
title: "Security headers and CSP"
description: "The Content-Security-Policy Veryfront applies by default, and how to allow Google Fonts, analytics, and other third-party origins."
order: 11
---

Every hosted Veryfront project is served with a Content-Security-Policy and a set of hardening headers. You do not switch them on — they apply in production whether or not you configure anything. What you do configure is the extra origins your own site needs.

## The default policy

In production, Veryfront serves this policy:

```http
default-src 'self';
script-src 'self' 'nonce-<generated>' https://esm.sh;
style-src 'self' 'unsafe-inline';
style-src-attr 'unsafe-inline';
img-src 'self' https://images.veryfront.com https://cdn.veryfront.com data:;
font-src 'self' data:;
connect-src 'self' https://esm.sh;
media-src 'self' blob:;
worker-src 'self' blob:;
object-src 'none';
frame-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

Alongside it: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, and `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` set to `same-origin`.

Development serves no CSP at all, so HMR and dev tooling are never blocked and a local allowance can never widen your production policy.

Two directives are worth understanding:

- **`script-src` includes `https://esm.sh`** because the renderer writes React imports from that CDN into every document. A fresh nonce is generated per response for the framework's own inline bootstrap.
- **`frame-ancestors`** is `'none'` on your own domain. On `*.veryfront.com` addresses it instead allows the Studio origins, so the Studio preview iframe works.

## Adding an origin

Set `security.csp` in `veryfront.config.ts`. Values are **added to** the defaults — you never restate them:

```ts
export default {
  security: {
    csp: {
      styleSrc: ["https://fonts.googleapis.com"],
      fontSrc: ["https://fonts.gstatic.com"],
    },
  },
};
```

That is the complete Google Fonts setup: `fonts.googleapis.com` serves the stylesheet, `fonts.gstatic.com` serves the font files, and both directives keep everything they already had.

Directive names may be camelCase (`fontSrc`) or the CSP spelling (`font-src`). Both work; camelCase matches the rest of your config. You do not need to repeat `'self'` — it is already there.

A few more examples:

```ts
security: {
  csp: {
    // An analytics endpoint your client code posts to
    connectSrc: ["https://analytics.example.com"],
    // Embedding YouTube
    frameSrc: ["https://www.youtube.com"],
    // Images from your own CDN
    imgSrc: ["https://cdn.example.com"],
  },
}
```

Misspelling a directive fails your build rather than silently doing nothing — browsers ignore unrecognized directive names, so `fontSource: [...]` would otherwise look configured and protect nothing.

## What you cannot remove

Some sources are structural: the renderer writes those URLs into the documents it serves, so a project that dropped them would break only its own site. `'self'`, the nonce, `https://esm.sh` in `script-src`, and the platform image origins are always present, whatever your config says.

Everything else is a convenience you may drop.

## Tightening the policy

To remove the platform's optional sources for one directive, set it to `null`:

```ts
security: {
  csp: {
    // Serve no inline styles. Keeps 'self'; drops 'unsafe-inline'.
    styleSrc: null,
  },
}
```

`null` removes the optional half of a directive and keeps the required half. It cannot lock you out of your own site.

Before doing this, check what your components actually need. `'unsafe-inline'` is in the default `style-src` because many React component libraries — including Veryfront's own — create styles at runtime. Removing it is safe only if you are certain yours do not.

## Replacing the policy entirely

Setting `VERYFRONT_CSP` in the environment replaces the whole policy, including the sources the renderer needs:

```bash
VERYFRONT_CSP="default-src 'self'; script-src 'self' 'nonce-{NONCE}'"
```

`{NONCE}` is substituted with the per-response nonce. Omitting `https://esm.sh` from `script-src` will stop your pages hydrating, so this is an operations-level escape hatch for policies you intend to own completely — not the way to add an origin. Use `security.csp` for that.

## Checking your policy

Load your site and open the browser console. CSP violations name the directive that blocked the request, which maps directly onto the config key: a `style-src-elem` violation is fixed with `styleSrc`, a `font-src` violation with `fontSrc`.

Preview deployments serve the same policy as production, so a CSP problem shows up on your preview URL before it reaches your live site.

## Related

- [Configuration](./configuration.md) — the full `veryfront.config.ts` reference
- [Middleware](./middleware.md) — CORS, rate limiting, and auth checks
- [Deploying](./deploying.md) — preview and production environments
