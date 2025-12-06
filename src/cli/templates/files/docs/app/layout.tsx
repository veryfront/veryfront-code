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
    <div className="min-h-screen bg-white">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 px-8 py-6 max-w-4xl">
          <article className="prose prose-slate max-w-none">
            {children}
          </article>
        </main>
      </div>
    </div>
  );
}