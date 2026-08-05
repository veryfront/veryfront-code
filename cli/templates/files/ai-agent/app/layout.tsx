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
        <title>Assistant</title>
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
      {children}
    </>
  );
}
