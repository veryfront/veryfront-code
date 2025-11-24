import type { ReactNode } from "react";

interface AppProps {
  children: ReactNode;
}

export default function App({ children }: AppProps) {
  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, sans-serif",
      maxWidth: "800px",
      margin: "0 auto",
      padding: "2rem"
    }}>
      <header style={{
        borderBottom: "2px solid #e5e7eb",
        paddingBottom: "1rem",
        marginBottom: "2rem"
      }}>
        <h1 style={{ margin: 0, color: "#1e40af" }}>
          Veryfront Data Fetching Demo
        </h1>
        <p style={{ margin: "0.5rem 0 0 0", color: "#6b7280" }}>
          Demonstrating SSR and SSG with ISR
        </p>
      </header>

      <main>
        {children}
      </main>

      <footer style={{
        borderTop: "2px solid #e5e7eb",
        paddingTop: "1rem",
        marginTop: "3rem",
        textAlign: "center",
        color: "#6b7280",
        fontSize: "0.875rem"
      }}>
        <p>Built with Veryfront - A modern React framework</p>
      </footer>
    </div>
  );
}
