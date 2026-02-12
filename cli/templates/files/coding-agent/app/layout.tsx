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
        {children}
      </div>
    </>
  );
}
