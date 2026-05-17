---
title: "Extension publishing"
description: "Package and publish reusable Veryfront extensions."
order: 31
---

# Extension publishing

Publish an extension when it should be reused across projects or installed as a first-party or third-party package.

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

## Related

- [Extensions](./extensions.md) - extension overview
- [Extension testing](./extension-testing.md) - test before publishing
- [`veryfront/extensions`](../reference/extensions.md) - extension API reference
