// Layout component for client-rendered pages
// Tailwind Play CDN is used for 'use client' pages where CSS classes are rendered dynamically
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <title>RSC Demo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className="h-full bg-white dark:bg-neutral-900">
        <nav className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-200 dark:border-neutral-800">
          <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
            <span className="text-lg font-semibold text-neutral-900 dark:text-white">
              RSC Demo
            </span>
          </div>
        </nav>
        <main className="max-w-3xl mx-auto px-6 py-12">{children}</main>
      </body>
    </html>
  );
}
