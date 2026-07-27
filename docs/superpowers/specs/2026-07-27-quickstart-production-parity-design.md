# Quickstart Production Parity Design

## Goal

Make the first deploy experience truthful and visually consistent:

```sh
npm create veryfront@latest my-app
cd my-app
npx veryfront deploy
```

The command must return only after the deployed environment URL serves the
new release, and the cloud release must include the same framework component
styles as local development and `veryfront build`.

## Current State

Current main already handles the foundational quickstart deploy flow:

- A generated project is deploy-ready.
- Deploy creates or resolves the cloud project.
- Deploy writes `veryfront.json` when it creates or links a project.
- Deploy pushes a first source snapshot without requiring a Git repository.
- Deploy creates and verifies the release, deploys it, and prints the
  environment URL.
- Human output states whether the environment is protected.
- Project lookup and release failures use actionable CLI errors.

Production testing on `veryfront@0.1.1159` found two remaining gaps:

1. Deploy reported success while the authenticated environment root still
   returned `404`. The route became available on a later poll.
2. Release CSS compilation scanned uploaded project source only. Framework
   chat components therefore rendered with correct DOM and working hydration,
   but without their Tailwind utilities. Local development and
   `veryfront build` explicitly add the generated framework candidate set.

## Chosen Design

### Release CSS parity

Release asset CSS generation will add `FRAMEWORK_CANDIDATES` to the candidates
extracted from uploaded project files before calling `compileProjectCss`.

This is the same generated input used by development CSS generation and the
local production build. It keeps all three compilation paths aligned without
walking dependency source or changing the public CSS API.

The release executor test will use a project source fixture that does not
contain a representative framework utility and assert that the CSS compiler
still receives it.

### Environment URL readiness

After canonical deployment verification succeeds, deploy will probe the
environment root with `GET` until it receives a successful response or the
bounded readiness timeout expires.

The readiness probe will:

- Retry network failures, `404`, `408`, `425`, `429`, and `5xx` responses.
- Fail immediately on other non-success responses with an actionable message.
- Use redirect mode `manual` so a sign-in page cannot be mistaken for the
  deployed application.
- For protected Veryfront-hosted URLs on `.veryfront.com` or `.veryfront.org`,
  authenticate with the existing CLI token as the `authToken` cookie.
- Never send the Veryfront token to a custom domain.
- For a protected custom URL, first confirm that the printed custom URL
  responds without credentials, then authenticate against the canonical
  Veryfront environment hostname to confirm the application is ready.
- Cancel or drain response bodies because readiness depends on response state,
  not page content.

The human spinner will say it is waiting for the environment URL. JSON mode
will emit a `wait-environment-url` step. The success result will continue to
print the actual environment URL and protected state.

Default readiness polling will use a two-second interval and a two-minute
timeout, matching the existing release-asset readiness budget. Internal
options will allow focused tests to use one-millisecond polling and short
bounds.

## Alternatives Rejected

### Scan transformed dependency modules for Tailwind candidates

Rejected because release asset generation already ships a generated,
version-matched framework candidate set. Walking or parsing the transformed
framework graph would duplicate work, increase first-deploy latency, and
create another candidate-discovery implementation.

### Trust routing convergence from the deployment API

Rejected because production evidence showed a converged deployment response
before the environment URL served the release. Control-plane convergence is
necessary but does not prove route readiness.

### Treat an unauthenticated redirect as readiness

Rejected because protected environments redirect to sign-in before the
application is inspected. A redirect proves authentication enforcement, not
that the release root is available.

### Send the CLI token to any configured environment domain

Rejected because custom domains are project-controlled origins. Veryfront
credentials must only be sent to Veryfront-hosted domains.

## Error Handling

Readiness timeout errors will include the environment URL, timeout duration,
and last observed status or sanitized network error. They will tell the user
that the deployment exists but the URL did not become ready, instead of
reporting a raw HTTP response.

Authentication failures for protected Veryfront-hosted environments will
state that readiness verification could not authenticate and recommend
running `veryfront login`.

No token, response body, internal hostname, or stack trace will be printed.

## Verification

Automated verification will cover:

- Release CSS compilation includes framework candidates plus project
  candidates.
- Readiness retries a transient `404` and succeeds on `200`.
- Protected Veryfront URLs receive the auth cookie.
- Custom domains never receive the auth cookie.
- Sign-in redirects fail with an authentication-oriented error.
- Timeout errors include useful status context.
- Human and JSON deploy flows wait for URL readiness before success.
- Existing deploy, release asset, formatting, lint, and type checks remain
  green.

Production verification after release will:

1. Scaffold a new `ai-agent` project with the published latest packages.
2. Run the local build and local browser check.
3. Run `npx veryfront@latest deploy`.
4. Confirm the command does not return while the environment root is `404`.
5. Open the printed protected URL with the stored auth cookie.
6. Confirm no failed runtime module, stylesheet, hydration runtime, or favicon
   requests.
7. Compare computed styles and screenshots with local.
8. Submit the calculator prompt and confirm the streamed answer.

## Acceptance Mapping

The existing implementation remains responsible for project creation,
automatic linking, `veryfront.json`, source push without Git, actionable API
errors, URL output, and protected-state output.

This follow-up closes the remaining browser-render and truthful-readiness
requirements. Completion requires both automated regression coverage and a
fresh production run on the released version.
