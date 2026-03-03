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

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_CLIENT_ID || '',
    },
  },
});

export async function login(email: string, password: string) {
  return signIn({ username: email, password });
}

export async function register(email: string, password: string, name: string) {
  return signUp({
    username: email,
    password,
    options: {
      userAttributes: { name },
    },
  });
}

export async function verify(email: string, code: string) {
  return confirmSignUp({ username: email, confirmationCode: code });
}

export async function forgotPassword(email: string) {
  return resetPassword({ username: email });
}

export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
) {
  return confirmResetPassword({
    username: email,
    confirmationCode: code,
    newPassword,
  });
}

export async function logout() {
  return signOut();
}

export async function getToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export async function getUser() {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}
