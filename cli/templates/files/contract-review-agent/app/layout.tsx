import { Head } from "veryfront/head";

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <>
      <Head><title>Contract Review</title></Head>
      <div className="flex flex-col h-screen">
        {children}
      </div>
    </>
  );
}
