# Build Module

## Purpose

The build module is Veryfront's comprehensive build system, responsible for transforming source code into optimized production bundles. It handles MDX compilation, asset optimization, code splitting, and SSG (Static Site Generation).

## Scope

### What this module does:

- MDX compilation to React components
- JavaScript/TypeScript bundling and code splitting
- CSS optimization with Lightning CSS
- Image optimization with Sharp
- Tailwind CSS processing
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
│   ├── image-optimizer/    # Sharp integration
│   ├── css-optimizer/      # Lightning CSS
│   └── tailwind-processor/ # Tailwind processing
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
- `sharp` (optional) - Image optimization
- `lightningcss` (optional) - CSS optimization
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
    autoprefixer: true,
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
        autoprefixer: true,
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
- [`transforms/`](./transforms/README.md) - Code transforms
- [`cli/`](../cli/README.md) - CLI commands

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

- Check Sharp installation: `npm ls sharp`
- Check Lightning CSS: `npm ls lightningcss`
- Disable optional optimizers if needed

## References

- [esbuild Documentation](https://esbuild.github.io/)
- [MDX Documentation](https://mdxjs.com/)
- [Veryfront Build Guide](https://veryfront.com/docs/build)
