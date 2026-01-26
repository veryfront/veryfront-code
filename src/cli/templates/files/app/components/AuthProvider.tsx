'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { logout as logoutUser } from '../lib/auth-client.ts';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;

    async function loadUser(): Promise<void> {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) return;

        const data = await res.json();
        if (active && data?.user) setUser(data.user);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadUser();

    return () => {
      active = false;
    };
  }, []);

  function logout(): void {
    logoutUser();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  return useContext(AuthContext);
}
