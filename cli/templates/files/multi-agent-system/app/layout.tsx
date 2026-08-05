import "../globals.css";
import { Head } from "veryfront/head";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <>
      <Head>
        <title>Multi-Agent System</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        {/*
          KaTeX ships its glyphs as ~60 font files referenced by relative URL
          from this stylesheet, so it is loaded from the published package
          rather than bundled: that keeps the fonts resolvable. The version is
          pinned to the `katex` dependency the renderer draws with, and the
          integrity hash is checked because this is a third-party fetch.
        */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.css"
          integrity="sha384-1vdNCNel6Tx/NQa8IR1mGOGKsbGreCkOPfbtPPnUURJ5Tu2PRVfQ/7KLZC+Pi1p1"
          crossOrigin="anonymous"
        />
      </Head>
      <div className="flex flex-col h-screen bg-white dark:bg-neutral-950">
        <header className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800">
          <div className="max-w-3xl mx-auto flex items-center gap-3 px-4 py-3">
            <div className="flex -space-x-2">
              <div className="w-7 h-7 rounded-full bg-blue-500 ring-2 ring-white dark:ring-neutral-950 flex items-center justify-center text-[10px] font-bold text-white">
                O
              </div>
              <div className="w-7 h-7 rounded-full bg-amber-500 ring-2 ring-white dark:ring-neutral-950 flex items-center justify-center text-[10px] font-bold text-white">
                R
              </div>
              <div className="w-7 h-7 rounded-full bg-violet-500 ring-2 ring-white dark:ring-neutral-950 flex items-center justify-center text-[10px] font-bold text-white">
                W
              </div>
            </div>
            <div>
              <h1 className="font-medium text-neutral-900 dark:text-white text-sm">
                Agent Team
              </h1>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Orchestrator, Researcher, Writer
              </p>
            </div>
          </div>
        </header>
        {children}
      </div>
    </>
  );
}
