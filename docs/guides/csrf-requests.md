---
title: "Send authenticated browser mutations"
description: "Include CSRF headers in custom browser requests and configure route-specific CSRF behavior."
order: 65
---

Use the CSRF helper when your application sends a custom request that changes server state. Authentication identifies the caller; the CSRF check validates the browser request token.

## Cross-site request forgery

Veryfront checks CSRF on every protected request whose method is not `GET`, `HEAD`, or `OPTIONS`. The check is a double-submit pair. Veryfront issues a CSRF cookie on HTML document responses, and your client code must send that same value back in an `x-csrf-token` header. HTTPS and loopback origins use `__Host-vf_csrf`. Plain-HTTP LAN development uses an origin-scoped `vf_csrf_http_<encoded-origin-and-config>` physical cookie plus a `vf_csrf_names_<encoded-origin>` discovery cookie, avoiding collisions with HTTPS siblings. During migration, an HTTPS origin uses `vf_csrf_https_<encoded-origin-and-config>` when an HTTP sibling still advertises the shared legacy token, so HTTPS does not make that token unreadable to the already-open HTTP app. A protected request that omits the header, sends an empty one, or sends a value that does not match the cookie receives `403`.

`veryfront dev` runs the same check as your deployed build. Earlier releases skipped it locally, so a mutating `fetch` you wrote by hand worked for as long as you were building the feature and then failed on the first deploy. It now fails on your machine instead, and the local `403` body names the cookie and the header your project expects.

### Send the token

Use `csrfMutationHeaders` from `veryfront/index.client`. It reads the cookie and returns the headers to hand to `fetch`:

```ts
import { csrfMutationHeaders } from "veryfront/index.client";

const response = await fetch("/api/cases", {
  method: "POST",
  headers: csrfMutationHeaders("/api/cases", {
    headers: { "content-type": "application/json" },
  }),
  body: JSON.stringify({ title: "Example case" }),
});
```

Veryfront's own client hooks send the header for you. That covers `useChat`, `useAgent`, `useStreaming`, `useCompletion`, the upload hooks, and the workflow hooks. Reach for the helper when you write the request yourself.

A machine client can satisfy the double-submit check by sending any matching
cookie/header pair together with its real authentication, as the curl examples
in this documentation do. Use `excludePaths` only when the entire route is
intentionally outside browser CSRF protection, such as a dedicated webhook
receiver, and authenticate that route independently.

### Choose your own names

Pass an object to `security.csrf` to rename either half of the pair, and give the browser helper the same names:

```ts
export default {
  security: {
    csrf: {
      cookieName: "my_csrf",
      headerName: "x-my-csrf",
      excludePaths: ["/api/webhooks"],
    },
  },
};
```

The server advertises configured names to Veryfront's browser hooks, so
`useChat`, `useAgent`, `useStreaming`, and `useCompletion` continue to work
without repeating them. For a hand-written request, discovery is automatic;
you can also pass the names explicitly when you need to override it:

```ts
const headers = csrfMutationHeaders("/api/cases", {
  cookieName: "my_csrf",
  headerName: "x-my-csrf",
  headers: { "content-type": "application/json" },
});
```

`excludePaths` takes canonical absolute paths. A listed path and everything under it skips the check, except `/`, which matches only the root path. This is what a third-party webhook receiver needs, because the sender holds no cookie of yours.

On plain-HTTP LAN development origins, browsers reject `Secure` `__Host-`
cookies. Veryfront therefore derives an origin-scoped
`vf_csrf_http_<encoded-origin-and-config>` token name and advertises it through
`vf_csrf_names_<encoded-origin>`. Use `csrfMutationHeaders` so discovery stays
automatic; do not read or construct the physical cookie name directly. The
header remains `x-csrf-token`, and HTTPS (including deployed origins) keeps the
hardened `__Host-vf_csrf` cookie.

### Turn the check off

Set `security.csrf` to `false`:

```ts
export default {
  security: {
    csrf: false,
  },
};
```

This is the only supported opt-out, and it applies in every environment. It stops the check and stops Veryfront issuing the cookie. Prefer `excludePaths` when only some routes need to be reachable without a token.

### What Veryfront exempts

- The CSP report endpoint, for the reason given in [Violation reports](./security-headers.md#violation-reports).
- Signed platform dispatches. Control-plane operations and channel invocations carry a signed envelope that the receiving handler verifies, and hold no cookie to echo.
- Two framework-owned local development surfaces: the client log endpoint at `/_veryfront/log` and the dashboard API under `/_dev/api/`. Both admit only a direct loopback connection from a canonical local-development host, and the dashboard requires its own port-scoped session token on top of that. Your own routes get no such exemption, in development or anywhere else.


## Verify it worked

In a signed-in browser session, submit the same request with and without the helper. With the matching token pair, the request should reach its handler. Without the required pair, the CSRF check should reject it. Confirm authentication still rejects callers without access, even when they provide a matching CSRF pair.

## Related

- [Application authentication](./application-auth.md): Identify and authorize the caller.
- [Security headers and CSP](./security-headers.md): Control browser resource loading.
