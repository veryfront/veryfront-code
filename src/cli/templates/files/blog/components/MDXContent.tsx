'use client';

import * as React from 'react';
import { MDXProvider } from '@mdx-js/react';

const components = {
  pre: ({ children, ...props }: React.ComponentProps<'pre'>): React.JSX.Element => (
    <pre {...props} className="bg-gray-100 p-4 rounded-lg overflow-x-auto">
      {children}
    </pre>
  ),
  code: ({ children, ...props }: React.ComponentProps<'code'>): React.JSX.Element => (
    <code {...props} className="bg-gray-100 px-1 py-0.5 rounded text-sm">
      {children}
    </code>
  ),
};

export function MDXContent({ content }: { content: React.ReactNode }): React.JSX.Element {
  return <MDXProvider components={components}>{content}</MDXProvider>;
}
