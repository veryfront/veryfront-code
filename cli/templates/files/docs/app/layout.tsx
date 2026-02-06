import { Header } from "../components/Header.tsx";
import { Sidebar } from "../components/Sidebar.tsx";

export const metadata = {
  title: "My Docs",
  description: "Documentation built with Veryfront",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-900">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 max-w-3xl px-8 py-8">
          <article className="prose prose-neutral max-w-none dark:prose-invert">
            {children}
          </article>
        </main>
      </div>
    </div>
  );
}
