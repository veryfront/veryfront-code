---
title: "Extension publishing"
description: "Package and publish reusable Veryfront extensions."
order: 41
---

Publish an extension when it should be reused across projects or installed as a first-party or third-party package.

## Prerequisites

- A passing extension test suite (see
  [Extension testing](./extension-testing.md)).
- A publish target: an npm scope, a JSR scope, or both.
- Authentication for the publish target (`npm login` or `deno publish` JSR
  credentials).

## Package checklist

1. Export the extension factory as the default export.
2. Set `veryfront.extension: true` in `deno.json` or `package.json`.
3. Declare capabilities in package metadata and in the factory.
4. Declare contract metadata through `contracts` or static `provides`.
5. Include tests for the factory and contract implementation.
6. Publish to npm or JSR.

## Install path

Users install the package and Veryfront discovers it:

```bash
deno add @myorg/ext-custom-cache
```

## Versioning

Use semver for package releases. Treat contract shape changes as breaking changes when downstream projects compile against the old contract.

## Verify it worked

After publishing:

1. Install the released package in a fresh test project.
2. Add the factory to `veryfront.config.ts` and run `veryfront dev`.
3. The dev log should list the extension under the published name. Calling
   the contract from app code should resolve through the published package
   rather than any local copy.

## Next

- [Building and deploying](./deploying.md): production builds and deployment
- [Configuration](./configuration.md): project configuration options

## Related

- [Extensions](./extensions.md): extension overview
- [Extension testing](./extension-testing.md): test before publishing
- [`veryfront/extensions`](../reference/veryfront/extensions.md): extension API reference
