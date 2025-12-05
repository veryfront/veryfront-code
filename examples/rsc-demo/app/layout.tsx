// Layout component for client-rendered pages
// Tailwind Play CDN is used for 'use client' pages where CSS classes are rendered dynamically
export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <title>RSC Demo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className="h-full bg-gray-50">
        {children}
      </body>
    </html>
  );
}
