/**
 * Docs template - Home page template
 * @module
 */

import type { TemplateFile } from "./types.ts";

/**
 * Home page template with welcome content
 *
 * Provides:
 * - Welcome message and overview
 * - Quick start guide
 * - Key features list
 * - Documentation structure
 * - Help resources
 *
 * @returns Template file for app/page.mdx
 */
export const homeTemplate: TemplateFile = {
  path: "app/page.mdx",
  content: `# Welcome to the Documentation

Welcome to our comprehensive documentation. Here you'll find everything you need to get started and make the most of our platform.

## Quick Start

Get up and running in minutes:

\`\`\`bash
# Install the CLI
deno install -A -n myapp https://example.com/cli.ts

# Create a new project
myapp init my-project

# Start development
cd my-project
myapp dev
\`\`\`

## Key Features

- **Fast** - Built for speed and efficiency
- **Secure** - Security-first architecture
- **Scalable** - Grows with your needs
- **Simple** - Easy to learn and use

## Documentation Structure

Our documentation is organized into the following sections:

### Getting Started
Learn the basics and get your first project running.

### Core Concepts
Understand the fundamental concepts and architecture.

### API Reference
Detailed API documentation with examples.

### Guides
Step-by-step tutorials for common use cases.

### Examples
Real-world examples and best practices.

## Need Help?

- Join our [Discord community](https://discord.gg/example)
- Check out our [GitHub discussions](https://github.com/example/discussions)
- Email support at support@example.com`,
};
