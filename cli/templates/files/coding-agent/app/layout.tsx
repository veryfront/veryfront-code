import { Head } from "veryfront/head";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <>
      <Head>
        <title>Code Agent</title>
      </Head>
      <div className="dark">
        <div className="flex flex-col h-screen bg-neutral-950">
          <header className="flex-shrink-0 border-b border-neutral-800">
            <div className="max-w-4xl mx-auto flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                  />
                </svg>
              </div>
              <div>
                <h1 className="font-medium text-white text-sm font-mono">
                  code-agent
                </h1>
                <p className="text-xs text-neutral-500">
                  read, search, edit project files
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-neutral-500 font-mono">ready</span>
              </div>
            </div>
          </header>
          {children}
        </div>
      </div>
    </>
  );
}
