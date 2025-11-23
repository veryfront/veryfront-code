/**
 * Docs template - Components
 */

import type { TemplateFile } from "../blog.ts";

export const docsComponentTemplates: TemplateFile[] = [
  {
    path: "components/Sidebar.tsx",
    content: `'use client';

import * as React from "react";
import { usePathname } from "next/navigation";

const navigation = [
  {
    title: "Getting Started",
    items: [
      { title: "Introduction", href: "/" },
      { title: "Installation", href: "/docs/getting-started" },
      { title: "Quick Start", href: "/docs/getting-started#quick-start" },
    ],
  },
  {
    title: "Core Concepts",
    items: [
      { title: "Overview", href: "/docs/core-concepts" },
      { title: "Architecture", href: "/docs/core-concepts#architecture" },
      { title: "Data Flow", href: "/docs/core-concepts#data-flow" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { title: "Core API", href: "/docs/api" },
      { title: "Components", href: "/docs/api#components" },
      { title: "Hooks", href: "/docs/api#hooks" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-gray-200 min-h-screen">
      <nav className="p-6 space-y-8">
        {navigation.map((section) => (
          <div key={section.title}>
            <h3 className="font-semibold text-gray-900 mb-3">
              {section.title}
            </h3>
            <ul className="space-y-2">
              {section.items.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className={\`block px-3 py-1.5 text-sm rounded-md transition-colors \${
                      pathname === item.href
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    }\`}
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}`,
  },
  {
    path: "components/Header.tsx",
    content: `'use client';

import React, { useState } from "react";

export function Header() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <a href="/" className="text-xl font-bold text-gray-900">
            📚 My Docs
          </a>
          <nav className="flex gap-6">
            <a href="/docs" className="text-gray-600 hover:text-gray-900">
              Docs
            </a>
            <a href="/api" className="text-gray-600 hover:text-gray-900">
              API
            </a>
            <a href="/examples" className="text-gray-600 hover:text-gray-900">
              Examples
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="search"
            placeholder="Search docs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select className="px-3 py-2 border border-gray-300 rounded-lg">
            <option>v2.0</option>
            <option>v1.0</option>
          </select>
          <a
            href="https://github.com/example/docs"
            className="text-gray-600 hover:text-gray-900"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}`,
  },
  {
    path: "components/CodeBlock.tsx",
    content: `'use client';

import React, { useState } from "react";

interface CodeBlockProps {
  children: string;
  language?: string;
  filename?: string;
}

export function CodeBlock({
  children,
  language = "typescript",
  filename
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      {filename && (
        <div className="bg-gray-700 text-gray-300 px-4 py-2 text-sm rounded-t-lg">
          {filename}
        </div>
      )}
      <pre className={\`bg-gray-800 text-gray-100 p-4 rounded-lg overflow-x-auto \${
        filename ? "rounded-t-none" : ""
      }\`}>
        <code className={\`language-\${language}\`}>{children}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 px-3 py-1 bg-gray-700 text-gray-300 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}`,
  },
];
