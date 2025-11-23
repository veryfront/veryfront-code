/**
 * Docs template - Root layout page template
 * @module
 */

import type { TemplateFile } from "./types.ts";

/**
 * Root layout template with sidebar and header
 *
 * Provides:
 * - HTML structure with metadata
 * - Tailwind CSS integration
 * - Prism syntax highlighting
 * - Sidebar navigation
 * - Responsive layout
 *
 * @returns Template file for app/layout.tsx
 */
export const layoutTemplate: TemplateFile = {
  path: "app/layout.tsx",
  content: `import * as React from "react";
import { Sidebar } from "../components/Sidebar";
import { Header } from "../components/Header";

export const metadata = {
  title: "My Docs",
  description: "Documentation built with Veryfront",
};

export default function RootLayout({
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
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css"
        />
      </head>
      <body className="bg-white">
        <Header />
        <div className="flex">
          <Sidebar />
          <main className="flex-1 px-8 py-6 max-w-4xl">
            <article className="prose prose-slate max-w-none">
              {children}
            </article>
          </main>
        </div>
      </body>
    </html>
  );
}`,
};
