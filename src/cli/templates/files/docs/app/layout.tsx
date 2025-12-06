import * as React from "react";
import { Sidebar } from "../components/Sidebar.tsx";
import { Header } from "../components/Header.tsx";

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
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
}