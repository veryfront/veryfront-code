---
title: "Security headers and CSP"
description: "Veryfront applies a Content-Security-Policy by default. Use this guide to allow analytics, embeds, and other third-party origins your site needs."
order: 11
---

Every hosted Veryfront project is served with a Content-Security-Policy and a set of hardening headers. You do not switch them on; they apply in production whether or not you configure anything. What you do configure is the extra origins your own site needs.

## The default policy

In production, Veryfront serves this policy:

```http
default-src 'self';
script-src 'self' 'nonce-<generated>' https://esm.sh;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
style-src-attr 'unsafe-inline';
img-src 'self' https://images.veryfront.com https://cdn.veryfront.com data:;
font-src 'self' data: https://fonts.gstatic.com;
connect-src 'self' https://esm.sh;
media-src 'self' blob:;
worker-src 'self' blob:;
object-src 'none';
frame-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
report-to veryfront-csp;
report-uri /_vf/csp-report
```

Alongside it: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` set to `same-origin`, and `Reporting-Endpoints: veryfront-csp="/_vf/csp-report"`, which defines the group the two reporting directives name.

Development serves no CSP at all, so HMR and dev tooling are never blocked and a local allowance can never widen your production policy.

Three directives are worth understanding:

- **`script-src` includes `https://esm.sh`** because the renderer writes React imports from that CDN into every document. A fresh nonce is generated per response for the framework's own inline bootstrap.
- **`style-src` and `font-src` include the Google Fonts origins** because `veryfront/fonts` writes those tags into the document itself. Google Fonts therefore works with no configuration. If your project never uses it, see [Tightening the policy](#tightening-the-policy).
- **`frame-ancestors`** is `'none'` on your own domain. On `*.veryfront.com` addresses it instead allows the Studio origins, so the Studio preview iframe works.

## What is enforced

The policy above is served as `Content-Security-Policy-Report-Only`: browsers report what it would have blocked, and block nothing.

Two directives are served enforced by default, in a second `Content-Security-Policy` header:

- `object-src 'none'` blocks `<object>`, `<embed>` and `<applet>`.
- `base-uri 'self'` blocks a `<base>` element pointing at another origin.

Both close injection routes, and neither can be widened: they are required directives, so `security.csp` cannot add sources to them or drop them.

The exception is `VERYFRONT_CSP`. Setting that environment variable replaces the policy wholesale and serves it enforced on its own, so neither the reported floor nor this pair is added alongside it. Writing a whole policy by hand is an explicit act, and Veryfront does not second-guess it.

**Every directive you give a value in `security.csp` is enforced too**, including `form-action` and `frame-ancestors`. Listing your image origins means you have thought about images, so `img-src` binds with your sources in it. Directives you never mentioned keep reporting, and so does one written as `undefined`, which counts as unconfigured rather than as a declaration. Adding one origin does not bind the rest of your policy, because deciding to allow a CDN and deciding to bind script execution across your site are different decisions.

One consequence worth knowing: CSP resolves a missing directive by falling back to a broader one, so enforcing `script-src` would otherwise also constrain workers and frames. Veryfront emits those alongside it, with the same sources the reported policy gives them, so declaring one directive never tightens another behind your back.

To bind a directive, configure it. To see what binding it would cost first, read the reports.

## Violation reports

The policy asks browsers to report what it blocks, to `/_vf/csp-report` on your own origin. Both spellings are sent because `report-to` is the current one and `report-uri` is still the only one several shipping browsers honour.

You do not configure this and cannot switch it off. Reports are recorded with the violating document, the directive, the blocked URL and the status. Query strings are removed, so identifiers in a URL do not reach a log. They are rate-limited, and the endpoint always answers `204`.

The endpoint is exempt from `security.auth` and `security.csrf`. A browser reports a violation without credentials and without a CSRF token, because a report is not a user action, so a protected project would otherwise report nothing at all. Exempting it discloses nothing: it reads no credentials, changes no state, and its response never varies.

## Adding an origin

Set `security.csp` in `veryfront.config.ts`. Values are **added to** the defaults, so you never restate them:

```ts
export default {
  security: {
    csp: {
      // An analytics endpoint your client code posts to
      connectSrc: ["https://analytics.example.com"],
    },
  },
};
```

`connect-src` keeps everything it already had and gains your origin.

Directive names may be camelCase (`fontSrc`) or the CSP spelling (`font-src`). Both work; camelCase matches the rest of your config. You do not need to repeat `'self'`; it is already there.

A font service other than Google's needs both halves, the stylesheet origin and the font-file origin:

```ts
export default {
  security: {
    csp: {
      styleSrc: ["https://use.typekit.net"],
      fontSrc: ["https://use.typekit.net"],
    },
  },
};
```

A few more examples:

```ts
export default {
  security: {
    csp: {
      // Embedding YouTube
      frameSrc: ["https://www.youtube.com"],
      // Images from your own CDN
      imgSrc: ["https://cdn.example.com"],
    },
  },
};
```

Misspelling a directive fails configuration loading rather than silently doing nothing. Browsers ignore unrecognized directive names, so `fontSource: [...]` would otherwise look configured and protect nothing.

## What you cannot remove

Some sources are structural: the renderer writes those URLs into the documents it serves, so a project that dropped them would break only its own site. `'self'`, the nonce, `https://esm.sh` in `script-src`, and the platform image origins are always present. No `security.csp` setting can remove them. (`VERYFRONT_CSP`, described below, is an operations-level exception.)

Everything else is a convenience you can drop.

## Tightening the policy

To remove the platform's optional sources for one directive, set it to `null`:

```ts
export default {
  security: {
    csp: {
      // Keeps 'self'. Drops 'unsafe-inline' and the Google Fonts origin.
      styleSrc: null,
    },
  },
};
```

`null` removes the optional half of a directive and keeps the required half. It cannot lock you out of your own site.

Before doing this, check what your components actually need. `'unsafe-inline'` is in the default `style-src` because many React component libraries, including Veryfront's own, create styles at runtime. Removing it is safe only if you are certain yours do not. The same setting drops the Google Fonts stylesheet origin, so only reach for it if your project does not use `veryfront/fonts`.

## Replacing the policy entirely

Setting `VERYFRONT_CSP` in the environment replaces the whole policy, including the sources the renderer needs:

```bash
VERYFRONT_CSP="default-src 'self'; script-src 'self' 'nonce-{NONCE}'"
```

`{NONCE}` is substituted with the per-response nonce. Omitting `https://esm.sh` from `script-src` will stop your pages hydrating, so this is an operations-level escape hatch for policies you intend to own completely, not the way to add an origin. Use `security.csp` for that.

## Verify it worked

Read the policy your site is actually serving:

```bash
curl -sS -D - -o /dev/null https://your-site.example/ | grep -i content-security-policy
```

Ensure the origin you added appears in the directive you added it to, alongside the existing sources.

Then load the site with the browser console open. CSP violations name the directive that blocked the request, which maps directly onto the config key: a `style-src` violation is fixed with `styleSrc`, a `font-src` violation with `fontSrc`.

Preview deployments serve the same policy as production, so a CSP problem shows up on your preview URL before it reaches your live site.

## Related

- [Configuration](./configuration.md): the full `veryfront.config.ts` reference
- [Middleware](./middleware.md): CORS, rate limiting, and auth checks
- [Deploying](./deploying.md): preview and production environments
