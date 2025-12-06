import * as React from "react";

export const metadata = {
  title: "My Blog",
  description: "A blog built with Veryfront",
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css"
        />
      </head>
      <body className="bg-gray-50">
        <header className="bg-white shadow-sm">
          <nav className="max-w-4xl mx-auto px-4 py-4">
            <div className="flex justify-between items-center">
              <a href="/" className="text-xl font-bold text-gray-900">
                My Blog
              </a>
              <div className="flex gap-6">
                <a href="/" className="text-gray-600 hover:text-gray-900">
                  Home
                </a>
                <a href="/about" className="text-gray-600 hover:text-gray-900">
                  About
                </a>
                <a href="/archive" className="text-gray-600 hover:text-gray-900">
                  Archive
                </a>
              </div>
            </div>
          </nav>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8">
          {children}
        </main>
        <footer className="bg-gray-100 mt-16">
          <div className="max-w-4xl mx-auto px-4 py-8 text-center text-gray-600">
            © 2024 My Blog. Built with Veryfront.
          </div>
        </footer>
      </body>
    </html>
  );
}