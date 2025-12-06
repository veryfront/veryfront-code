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
    <div className="min-h-screen bg-white dark:bg-neutral-900">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 px-8 py-8 max-w-3xl">
          <article className="prose prose-neutral dark:prose-invert max-w-none">
            {children}
          </article>
        </main>
      </div>
    </div>
  );
}
