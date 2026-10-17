import { createContext } from 'react';
import type { User } from './types';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Why a signed-in visitor has no account to show: maintenance mode or closed sign-ups (the API's message). */
  notice: string | null;
  refresh: () => Promise<void>;
}

/** The signed-in user's account (GET /api/account), provided by App.tsx's UserApp. */
export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  notice: null,
  refresh: async () => {},
});
