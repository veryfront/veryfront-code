import type { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="root-layout">
      <nav className="main-nav">
        <a href="/">Home</a>
        {' | '}
        <a href="/static">Static Page</a>
        {' | '}
        <a href="/docs/getting-started">Documentation</a>
      </nav>

      <div className="page-content">{children}</div>

      <aside className="info-box">
        <p>💡 This content is from the root layout (pages/layout.tsx)</p>
      </aside>
    </div>
  )
}
