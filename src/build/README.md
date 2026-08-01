# Build Module

## Purpose

The build module is Veryfront's comprehensive build system, responsible for transforming source code into optimized production bundles. It handles MDX compilation, asset optimization, code splitting, and SSG (Static Site Generation).

## Scope

### What this module does:

- MDX compilation to React components
- JavaScript/TypeScript bundling and code splitting
- CSS optimization through an explicitly composed provider
- Image optimization through an explicitly composed provider
- Tailwind CSS processing through an explicitly composed provider
- Static site generation (SSG)
- Asset pipeline orchestration
- Production build optimization

### What this module does NOT do:

- Development server (see `server/dev-server/`)
- Runtime code transformation (see `transforms/`)
- Request handling (see `server/`)

## Architecture

```
build/
├── asset-pipeline/          # Image/CSS optimization
│   ├── image-optimizer/    # Provider-neutral image optimization
│   ├── css-optimizer/      # Provider-neutral CSS optimization
│   └── tailwind-processor/ # Provider-neutral Tailwind orchestration
├── compiler/               # MDX → React compilation
│   ├── mdx-compiler/      # MDX processor
│   └── mdx-to-js.ts       # JavaScript output
├── bundler/               # JavaScript bundling
│   ├── code-splitter/     # Route-based splitting
│   └── esbuild-wrapper.ts # esbuild integration
├── renderer-bundler/      # Component bundling
│   ├── services/          # MDX/Script bundlers
│   └── types/             # Bundler types
├── config/                # Build configuration
└── embedded/              # Embedded resources
```

## Key Exports

### Main Build Functions

- `buildProduction(config)` - Full production build
- `buildStatic(routes, config)` - Static site generation
- `compileM

DX(source, options)` - MDX compilation

### Asset Pipeline

- `runAssetPipeline(options)` - Execute optimization
- `ImageOptimizer` - Image processing
- `CSSOptimizer` - CSS minification

### Types

- `BuildConfig` - Build configuration
- `BundleResult` - Build output
- `AssetPipelineResult` - Optimization stats

## Dependencies

### Internal

- `rendering/` - SSR for SSG
- `transforms/` - Code transformations
- `config/` - Configuration loading

### External

- `esbuild` - JavaScript bundling
- `@veryfront/ext-image-sharp` (optional) - Explicit image optimization provider
- `@veryfront/ext-css-lightning` (optional) - Explicit Lightning CSS provider
- `@veryfront/ext-css-purgecss` (optional) - Explicit CSS purging provider
- `@veryfront/ext-css-tailwind` (optional) - Explicit Tailwind CSS provider
- `@mdx-js/mdx` - MDX compilation

## Usage Examples

### Production Build

```typescript
import { buildProduction } from "./build";

const result = await buildProduction({
  projectDir: "./my-app",
  outputDir: ".veryfront/build",
  minify: true,
  sourcemap: true,
});

console.log(`Built ${result.pages.length} pages`);
```

### Static Site Generation

```typescript
import { buildStatic } from './build'

const routes = ['/

', '/about', '/blog/post-1']

const result = await buildStatic(routes, {
  projectDir: './my-app',
  outputDir: './dist',
})

console.log(`Generated ${result.staticPages.length} static pages`)
```

### Asset Optimization

Compose the provider extensions for every enabled stage during application
setup. See
[`@veryfront/ext-image-sharp`](../../extensions/ext-image-sharp/README.md),
[`@veryfront/ext-css-lightning`](../../extensions/ext-css-lightning/README.md),
and [`@veryfront/ext-css-tailwind`](../../extensions/ext-css-tailwind/README.md).
Absent stages are skipped; a requested stage fails the build if its provider or
processing fails.

```typescript
import { runAssetPipeline } from "./build/asset-pipeline";

const result = await runAssetPipeline({
  images: {
    enabled: true,
    formats: ["webp", "avif"],
    sizes: [640, 1280, 1920],
  },
  css: {
    enabled: true,
    minify: true,
  },
  tailwind: {
    enabled: true,
    projectDir: "./my-app",
  },
});

console.log(`Optimized ${result.images.optimized} images`);
console.log(`CSS savings: ${result.css.savings}%`);
```

### MDX Compilation

```typescript
import { compileMDX } from "./build/compiler";

const mdxSource = `
# Hello World

This is **MDX** with components!

<CustomComponent prop="value" />
`;

const result = await compileMDX(mdxSource, {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [rehypePrism],
});

console.log(result.code); // Compiled React component
```

## Build Configuration

### veryfront.config.ts

```typescript
export default {
  build: {
    outDir: ".veryfront/build",
    assets: {
      images: {
        formats: ["webp", "avif"],
        quality: 80,
      },
      css: {
        minify: true,
      },
    },
    splitting: {
      strategy: "route", // 'route' | 'manual'
      chunkSize: 500_000, // 500KB
    },
    sourcemap: true,
    minify: true,
  },
};
```

Browser targets belong to the explicit Lightning CSS extension, not the core
asset-pipeline configuration. Configure `browserQueries` when composing
`@veryfront/ext-css-lightning`; requested optimization fails closed when no
`CSSOptimizationEngine` provider is registered.

### Provider status fields

`checkAssetPipelineDependencies()` returns provider-neutral capability status:

```typescript
{
  imageOptimization: boolean;
  cssOptimization: boolean;
}
```

The former `sharp` and `lightningCSS` properties are removed. Consumers of the
status helper must read `imageOptimization` and `cssOptimization`; the helper
does not report package discovery because core validates registered contracts.

## Performance

### Build Times (Typical Project)

- Small (10 pages): ~2-5 seconds
- Medium (100 pages): ~10-20 seconds
- Large (1000 pages): ~1-2 minutes

### Optimization Strategies

1. **Incremental builds**: Only rebuild changed files
2. **Parallel processing**: Build routes concurrently
3. **Caching**: Cache compilation results
4. **Code splitting**: Route-based chunks

## Testing

```bash
# Run build tests
deno task test src/build/

# Test asset pipeline
deno task test src/build/asset-pipeline/

# Test MDX compilation
deno task test src/build/compiler/
```

## Maintainer

**Team:** Build & Infrastructure Team
**Code Owners:** See CODEOWNERS file

## Related Modules

- [`server/`](../server/README.md) - Development server
- [`rendering/`](../rendering/README.md) - SSR/RSC rendering
- [`transforms/`](../transforms/README.md) - Code transforms
- [`cli/`](../../cli/README.md) - CLI commands

## Troubleshooting

### Out of Memory Errors

```bash
# Increase Node.js memory
NODE_OPTIONS="--max-old-space-size=4096" deno task build
```

### Slow Builds

- Enable incremental builds
- Reduce concurrent routes
- Disable sourcemaps in development

### Asset Optimization Failures

- Ensure `@veryfront/ext-image-sharp` is installed and explicitly composed
- Ensure `@veryfront/ext-css-lightning` is installed and explicitly composed
- Ensure `@veryfront/ext-css-tailwind` is installed and explicitly composed
- Disable optional optimizers if needed

## References

- [esbuild Documentation](https://esbuild.github.io/)
- [MDX Documentation](https://mdxjs.com/)
- [Veryfront Build Guide](https://veryfront.com/docs/build)
