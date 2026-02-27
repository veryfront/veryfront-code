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
      </Head>
      <div className="flex flex-col h-screen bg-white dark:bg-neutral-900">
        {children}
      </div>
    </>
  );
}
