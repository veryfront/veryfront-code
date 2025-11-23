/**
 * Minimal starter template for Veryfront
 */

import type { TemplateFile } from "./blog.ts";

export const minimalTemplate: TemplateFile[] = [
  {
    path: "veryfront.config.js",
    content: `export default {
  title: "My Veryfront App",
  description: "A minimal Veryfront starter",
  
  dev: {
    port: 3002,
    open: true,
  },
  
  resolve: {
    importMap: {
      imports: {
        "react": "https://esm.sh/react@19.1.1",
        "react/jsx-runtime": "https://esm.sh/react@19.1.1/jsx-runtime",
        "react-dom": "https://esm.sh/react-dom@19.1.1",
        "react-dom/client": "https://esm.sh/react-dom@19.1.1/client",
      },
    },
  },

  cache: {
    dir: ".veryfront/cache",
    render: {
      type: "memory",
      ttl: 60 * 1000,
      maxEntries: 200,
    },
  },
};`,
  },
  {
    path: "app/layout.tsx",
    content: `export default function RootLayout({ 
  children 
}: { 
  children: React.ReactNode 
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css"
        />
      </head>
      <body className="p-8">
        {children}
      </body>
    </html>
  );
}`,
  },
  {
    path: "app/page.tsx",
    content: `export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold mb-4">
        Welcome to Veryfront
      </h1>
      <p className="text-gray-600 mb-8">
        Edit <code className="bg-gray-100 px-1 rounded">app/page.tsx</code> to get started.
      </p>
      <div className="flex gap-4">
        <a 
          href="/about"
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          About
        </a>
        <a 
          href="https://github.com/veryfront/veryfront"
          className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
        >
          Documentation
        </a>
      </div>
    </div>
  );
}`,
  },
  {
    path: "app/about/page.mdx",
    content: `# About

This is a minimal Veryfront starter template.

## Features

- ⚡ Fast development with HMR
- 📝 MDX support out of the box
- 🎨 Tailwind CSS included
- 🚀 Production ready

## Getting Started

1. Edit pages in the \`app\` directory
2. Add components in \`components\`
3. Configure your app in \`veryfront.config.js\`

Happy coding!`,
  },
  {
    path: "public/favicon.ico",
    content: ``,
  },
];
