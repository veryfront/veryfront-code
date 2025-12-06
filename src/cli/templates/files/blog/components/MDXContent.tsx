'use client';

import * as React from "react";
import { MDXProvider } from "@mdx-js/react";

const components = {
  // Add custom components here
  pre: ({ children, ...props }: React.ComponentProps<'pre'>) => (
    <pre {...props} className="bg-gray-100 p-4 rounded-lg overflow-x-auto">
      {children}
    </pre>
  ),
  code: ({ children, ...props }: React.ComponentProps<'code'>) => (
    <code {...props} className="bg-gray-100 px-1 py-0.5 rounded text-sm">
      {children}
    </code>
  ),
};

export function MDXContent({ content }: { content: React.ReactNode }) {
  return (
    <MDXProvider components={components}>
      {content}
    </MDXProvider>
  );
}