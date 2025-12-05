import type { ReactNode } from "react";

interface AppProps {
  children: ReactNode;
}

export default function App({ children }: AppProps) {
  return (
    <div className="font-sans max-w-3xl mx-auto p-8">
      <header className="border-b-2 border-gray-200 pb-4 mb-8">
        <h1 className="text-2xl font-bold text-blue-800 m-0">
          Veryfront Data Fetching Demo
        </h1>
        <p className="text-gray-500 mt-2 mb-0">
          Demonstrating SSR and SSG with ISR
        </p>
      </header>

      <main>
        {children}
      </main>

      <footer className="border-t-2 border-gray-200 pt-4 mt-12 text-center text-gray-500 text-sm">
        <p>Built with Veryfront - A modern React framework</p>
      </footer>
    </div>
  );
}
