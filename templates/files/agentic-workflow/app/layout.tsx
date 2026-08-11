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
        <title>AI Workflows</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>
      {children}
    </>
  );
}
