import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import type { User } from './types.ts';

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => api.get<User>('/auth/me').then(setUser, () => setUser(null)), []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const onSignedOut = () => setUser(null);
    window.addEventListener('bellhop:signed-out', onSignedOut);
    return () => window.removeEventListener('bellhop:signed-out', onSignedOut);
  }, [refresh]);

  const login = async (username: string, password: string) => {
    await api.post('/auth/login', { username, password });
    await refresh();
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
