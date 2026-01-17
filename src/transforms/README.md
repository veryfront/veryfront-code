# Transforms Domain

**Purpose**: Code transformation for ESM, MDX, and plugin systems

## Overview

The transforms domain handles all code transformation operations:

- **ESM Transformation**: Convert TypeScript/JSX to browser-compatible ESM
- **MDX Compilation**: Compile MDX files to React components
- **Plugin System**: Remark/Rehype plugins for content transformation

## Structure

```
transforms/
├── index.ts              # Barrel exports
├── esm-transform.ts      # Entry point for ESM transformation
├── esm/                  # ESM transformation engine
│   ├── transformer.ts    # Core transformation logic
│   ├── import-rewriter.ts
│   └── types.ts
├── mdx/                  # MDX compilation system
│   ├── compiler/         # MDX compiler
│   ├── module-loader/    # MDX module loading
│   └── types.ts
└── plugins/              # Plugin system
    ├── plugin-loader.ts
    └── remark-*.ts       # Remark plugins
```

## Quick Start

```ts
import { mdxRenderer, transformToESM } from "@veryfront/internal";

// Transform TypeScript to ESM
const result = await transformToESM(code, {
  filename: "component.tsx",
  jsx: "react",
});

// Render MDX (for runtime usage)
const module = await mdxRenderer.loadModuleESM(compiledCode);
// Use module.default or module exports
```

## Key Files

- **esm-transform.ts**: Main entry point for ESM transformation
- **mdx/compiler/mdx-compiler.ts**: MDX compilation logic
- **plugins/plugin-loader.ts**: Plugin loading and configuration

## Use Cases

1. **Development Server**: Transform modules on-the-fly for HMR
2. **Build System**: Pre-compile all modules for production
3. **Content Sites**: Compile MDX files to React components
4. **Plugin Extensions**: Apply custom transformations via plugins

## Testing

Tests are co-located with their modules:

- `esm/*.test.ts` - ESM transformation tests
- `mdx/**/*.test.ts` - MDX compilation tests
- `plugins/*.test.ts` - Plugin system tests
