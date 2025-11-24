import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export default function DocsLayout({ children }: LayoutProps) {
  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <h2>Documentation</h2>
        <nav>
          <ul>
            <li><a href="/docs/getting-started">Getting Started</a></li>
            <li><a href="/docs/data-fetching">Data Fetching</a></li>
            <li><a href="/">Back to Home</a></li>
          </ul>
        </nav>
      </aside>
      <div className="docs-content">
        {children}
      </div>
    </div>
  );
}
