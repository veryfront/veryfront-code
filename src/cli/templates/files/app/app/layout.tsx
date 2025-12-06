import * as React from "react";
import { AuthProvider } from "../components/AuthProvider.tsx";
import { Toaster } from "../components/Toaster.tsx";

export const metadata = {
  title: "My App",
  description: "A full-stack app built with Veryfront",
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
        <Toaster />
      </div>
    </AuthProvider>
  );
}