// The admin site's own sign-in (same Cognito user pool as the user site, separate session: admin.<domain> is another
// origin). Never the test stage's username login: test-login accounts can't be admins. MOCK_AUTH in local dev signs in
// as a mock admin with any email and password (api.ts answers from mock.ts).
import { createAuth } from '@yourapp/shared';

export const { MOCK_AUTH, login, logout, getToken, getUser, mockUsername } = createAuth({
  storageKey: 'yourapp-admin',
  allowTestLogin: false,
});
