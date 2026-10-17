// The user site's sign-in: Cognito, the test stage's username login, or MOCK_AUTH in local dev (packages/shared/src/auth.ts).
import { createAuth } from '@yourapp/shared';

export const {
  MOCK_AUTH, TEST_LOGIN, login, register, verify, forgotPassword, confirmForgotPassword, logout, getToken, getUser, mockUsername,
} = createAuth({ storageKey: 'yourapp', allowTestLogin: true });
