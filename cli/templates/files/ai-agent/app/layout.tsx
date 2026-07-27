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
        <title>AI Chat</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>
      <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
        {children}
      </div>
    </>
  );
}
