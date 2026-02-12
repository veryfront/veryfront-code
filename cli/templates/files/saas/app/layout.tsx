import { Head } from "veryfront/head";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <>
      <Head>
        <title>AI SaaS</title>
      </Head>
      <div className="antialiased">
        {children}
      </div>
    </>
  );
}
