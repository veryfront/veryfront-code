import { Head } from "veryfront/head";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <>
      <Head>
        <title>Chat with Your Docs</title>
      </Head>
      {children}
    </>
  );
}
