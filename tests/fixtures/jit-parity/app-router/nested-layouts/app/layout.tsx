import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>Root Header</header>
        <main>{children}</main>
        <footer>Root Footer</footer>
      </body>
    </html>
  );
}
