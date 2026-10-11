import { Amplify } from 'aws-amplify';
import {
  signIn,
  signUp,
  confirmSignUp,
  resetPassword,
  confirmResetPassword,
  signOut,
  fetchAuthSession,
  getCurrentUser,
} from 'aws-amplify/auth';

// Three ways to be signed in, decided at build time:
//   Cognito     the deployed site (VITE_USER_POOL_ID/VITE_CLIENT_ID written by scripts/deploy.sh)
//   TEST_LOGIN  the test stage only (VITE_TEST_LOGIN=1): username, no password, token from POST /api/test-login
//   MOCK_AUTH   `npm run dev` with no Cognito pool configured: a fake session in localStorage, no backend needed
// Both TEST_LOGIN and MOCK_AUTH are constant false in a prod build, so their branches are compiled out of it.

/** Local development only: the Vite dev server with no Cognito pool configured. `import.meta.env.DEV` is false in
 *  every production build, so the mock never ships. */
export const MOCK_AUTH = import.meta.env.DEV && !import.meta.env.VITE_USER_POOL_ID;
const MOCK_SESSION_KEY = 'yourapp-mock-session';

/** Test stage only (VITE_TEST_LOGIN is written by scripts/deploy.sh / local-test.sh for STAGE=test). */
export const TEST_LOGIN = import.meta.env.VITE_TEST_LOGIN === '1';
const TEST_SESSION_KEY = 'yourapp-test-session';

if (!MOCK_AUTH && !TEST_LOGIN) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_USER_POOL_ID || '',
        userPoolClientId: import.meta.env.VITE_CLIENT_ID || '',
      },
    },
  });
}

interface LocalSession {
  username: string;
  token: string;
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

/** The mock session's username (MOCK_AUTH only), for the mock account in api.ts. */
export function mockUsername(): string | null {
  return MOCK_AUTH ? readSession(MOCK_SESSION_KEY)?.username ?? null : null;
}

async function testLogin(username: string) {
  const res = await fetch('/api/test-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Test login failed');
  writeSession(TEST_SESSION_KEY, { username: body.username, token: body.token });
}

const notInLocalMode = () => {
  throw new Error('This needs a Cognito user pool. Run scripts/local-test.sh web to use a deployed stage.');
};

export async function login(email: string, password: string) {
  if (TEST_LOGIN) return testLogin(email);
  if (MOCK_AUTH) {
    if (!email.trim() || !password) throw new Error('Enter any email and password.');
    writeSession(MOCK_SESSION_KEY, { username: email.trim(), token: 'mock-token' });
    return;
  }
  return signIn({ username: email, password });
}

export async function register(email: string, password: string, name: string) {
  if (TEST_LOGIN) return testLogin(email);
  if (MOCK_AUTH) return notInLocalMode();
  return signUp({
    username: email,
    password,
    options: {
      userAttributes: { name },
    },
  });
}

export async function verify(email: string, code: string) {
  if (TEST_LOGIN || MOCK_AUTH) return notInLocalMode();
  return confirmSignUp({ username: email, confirmationCode: code });
}

export async function forgotPassword(email: string) {
  if (TEST_LOGIN || MOCK_AUTH) return notInLocalMode();
  return resetPassword({ username: email });
}

export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
) {
  if (TEST_LOGIN || MOCK_AUTH) return notInLocalMode();
  return confirmResetPassword({
    username: email,
    confirmationCode: code,
    newPassword,
  });
}

export async function logout() {
  if (TEST_LOGIN) return writeSession(TEST_SESSION_KEY, null);
  if (MOCK_AUTH) return writeSession(MOCK_SESSION_KEY, null);
  return signOut();
}

export async function getToken(): Promise<string | null> {
  if (TEST_LOGIN) return readSession(TEST_SESSION_KEY)?.token ?? null;
  if (MOCK_AUTH) return readSession(MOCK_SESSION_KEY)?.token ?? null;
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export async function getUser(): Promise<{ username: string } | null> {
  if (TEST_LOGIN) return readSession(TEST_SESSION_KEY);
  if (MOCK_AUTH) return readSession(MOCK_SESSION_KEY);
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}
