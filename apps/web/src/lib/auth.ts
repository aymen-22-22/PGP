import type { AuthUser } from '@phone-erp/shared-types';
import { create } from 'zustand';
import { ApiRequestError, api } from './api';

interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  setUser: (user: AuthUser | null) => void;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * The only piece of genuinely global client state: who is signed in. Everything
 * else is server state and lives in TanStack Query.
 */
export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: 'loading',

  setUser: (user) => set({ user, status: user ? 'authenticated' : 'anonymous' }),

  signIn: async (email, password) => {
    const result = await api.post<{ user: AuthUser }>('/auth/login', { email, password });
    set({ user: result.user, status: 'authenticated' });
    return result.user;
  },

  signOut: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      set({ user: null, status: 'anonymous' });
    }
  },

  /**
   * Re-reads the session.
   *
   * Only a real authentication failure signs the user out. A network error must
   * not: warehouse wifi drops, and bouncing someone to the login screen
   * mid-scan — when their session is perfectly valid — loses their work for no
   * reason. The session cookie is still there, so the next successful call
   * picks straight up.
   */
  refresh: async () => {
    try {
      const user = await api.get<AuthUser>('/auth/me');
      set({ user, status: 'authenticated' });
    } catch (error) {
      const unreachable = error instanceof ApiRequestError && error.isUnreachable;
      if (unreachable && get().user) return; // keep them signed in; the screens show the error
      set({ user: null, status: 'anonymous' });
    }
  },
}));

export const isAdmin = (user: AuthUser | null): boolean => user?.role === 'ADMIN';
