/**
 * Docs template - Getting started page template
 * @module
 */

import type { TemplateFile } from "./types.ts";

/**
 * Getting started guide template
 *
 * Provides:
 * - Prerequisites checklist
 * - Installation instructions
 * - First project setup
 * - Running the development server
 * - Next steps navigation
 *
 * @returns Template file for app/docs/getting-started/page.mdx
 */
export const gettingStartedTemplate: TemplateFile = {
  path: "app/docs/getting-started/page.mdx",
  content: `# Getting Started

This guide will help you get started with our platform in just a few minutes.

## Prerequisites

Before you begin, make sure you have:

- Deno 1.40 or later installed
- A text editor (we recommend VS Code)
- Basic knowledge of JavaScript/TypeScript

## Installation

### Using Deno

\`\`\`bash
deno install -A -n myapp https://example.com/cli.ts
\`\`\`

### From Source

\`\`\`bash
git clone https://github.com/example/myapp
cd myapp
deno task install
\`\`\`

## Creating Your First Project

Once installed, create a new project:

\`\`\`bash
myapp init my-first-project
cd my-first-project
\`\`\`

This creates a new project with the following structure:

\`\`\`
my-first-project/
├── src/
│   ├── main.ts
│   └── utils.ts
├── tests/
│   └── main_test.ts
├── deno.json
└── README.md
\`\`\`

## Running Your Project

Start the development server:

\`\`\`bash
myapp dev
\`\`\`

Your application will be available at \`http://localhost:3000\`.

## Next Steps

Now that you have a project running, explore:

- [Core Concepts](/docs/core-concepts) - Understand the architecture
- [Configuration](/docs/configuration) - Customize your setup
- [Deployment](/docs/deployment) - Deploy to production`,
};
