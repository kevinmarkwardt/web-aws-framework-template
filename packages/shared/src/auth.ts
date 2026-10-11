import { Amplify } from 'aws-amplify';
import {
  confirmResetPassword,
  confirmSignUp,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth';

// Three ways to be signed in, decided at build time from the app's Vite env:
//   Cognito     a deployed site (VITE_USER_POOL_ID / VITE_CLIENT_ID written by scripts/deploy.sh)
//   TEST_LOGIN  the user site on the test stage only (VITE_TEST_LOGIN=1): username, no password, token from
//               POST /api/test-login. The admin site never allows it (test-login accounts can't be admins).
//   MOCK_AUTH   `npm run dev` with no Cognito pool configured: a fake session in localStorage, no backend needed
// MOCK_AUTH is constant false in every production build (import.meta.env.DEV), so it never ships.

/** Local development only: the Vite dev server with no Cognito pool configured. */
export const MOCK_AUTH: boolean = import.meta.env.DEV && !import.meta.env.VITE_USER_POOL_ID;

export interface AuthOptions {
  /** Prefix of this app's localStorage keys (the two sites are separate origins anyway). */
  storageKey: string;
  /** Allow the test stage's username login (the user site only). */
  allowTestLogin: boolean;
}

interface LocalSession {
  username: string;
  token: string;
}

export interface Auth {
  MOCK_AUTH: boolean;
  TEST_LOGIN: boolean;
  login: (email: string, password: string) => Promise<{ done: boolean; nextStep?: string }>;
  register: (email: string, password: string, name: string) => Promise<unknown>;
  verify: (email: string, code: string) => Promise<unknown>;
  forgotPassword: (email: string) => Promise<unknown>;
  confirmForgotPassword: (email: string, code: string, newPassword: string) => Promise<unknown>;
  logout: () => Promise<void>;
  /** The ID token (it carries cognito:groups), or null. */
  getToken: () => Promise<string | null>;
  getUser: () => Promise<{ username: string } | null>;
  /** MOCK_AUTH only: the mock session's username. */
  mockUsername: () => string | null;
}

function readSession(key: string): LocalSession | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LocalSession) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, session: LocalSession | null) {
  try {
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked: the session lasts until reload */
  }
}

let configured = false;

export function createAuth(opts: AuthOptions): Auth {
  const TEST_LOGIN = opts.allowTestLogin && import.meta.env.VITE_TEST_LOGIN === '1';
  const mockKey = `${opts.storageKey}-mock-session`;
  const testKey = `${opts.storageKey}-test-session`;

  if (!MOCK_AUTH && !TEST_LOGIN && !configured) {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: import.meta.env.VITE_USER_POOL_ID || '',
          userPoolClientId: import.meta.env.VITE_CLIENT_ID || '',
        },
      },
    });
    configured = true;
  }

  const notInLocalMode = () => {
    throw new Error('This needs a Cognito user pool. Run scripts/local-test.sh web (or admin) to use a deployed stage.');
  };

  async function testLogin(username: string) {
    const res = await fetch('/api/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Test login failed');
    writeSession(testKey, { username: body.username, token: body.token });
  }

  return {
    MOCK_AUTH,
    TEST_LOGIN,
    async login(email, password) {
      if (TEST_LOGIN) {
        await testLogin(email);
        return { done: true };
      }
      if (MOCK_AUTH) {
        if (!email.trim() || !password) throw new Error('Enter any email and password.');
        writeSession(mockKey, { username: email.trim(), token: 'mock-token' });
        return { done: true };
      }
      const out = await signIn({ username: email, password });
      return { done: out.isSignedIn, nextStep: out.nextStep?.signInStep };
    },
    async register(email, password, name) {
      if (TEST_LOGIN) return testLogin(email);
      if (MOCK_AUTH) return notInLocalMode();
      return signUp({ username: email, password, options: { userAttributes: { name } } });
    },
    async verify(email, code) {
      if (TEST_LOGIN || MOCK_AUTH) return notInLocalMode();
      return confirmSignUp({ username: email, confirmationCode: code });
    },
    async forgotPassword(email) {
      if (TEST_LOGIN || MOCK_AUTH) return notInLocalMode();
      return resetPassword({ username: email });
    },
    async confirmForgotPassword(email, code, newPassword) {
      if (TEST_LOGIN || MOCK_AUTH) return notInLocalMode();
      return confirmResetPassword({ username: email, confirmationCode: code, newPassword });
    },
    async logout() {
      if (TEST_LOGIN) return writeSession(testKey, null);
      if (MOCK_AUTH) return writeSession(mockKey, null);
      await signOut();
    },
    async getToken() {
      if (TEST_LOGIN) return readSession(testKey)?.token ?? null;
      if (MOCK_AUTH) return readSession(mockKey)?.token ?? null;
      try {
        const session = await fetchAuthSession();
        return session.tokens?.idToken?.toString() ?? null;
      } catch {
        return null;
      }
    },
    async getUser() {
      if (TEST_LOGIN) return readSession(testKey);
      if (MOCK_AUTH) return readSession(mockKey);
      try {
        return await getCurrentUser();
      } catch {
        return null;
      }
    },
    mockUsername() {
      return MOCK_AUTH ? readSession(mockKey)?.username ?? null : null;
    },
  };
}
