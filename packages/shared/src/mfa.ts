import { confirmSignIn, fetchMFAPreference, setUpTOTP, updateMFAPreference, verifyTOTPSetup } from 'aws-amplify/auth';

// Authenticator-app (TOTP) MFA on the Cognito user pool (Cognito only: not with TEST_LOGIN or MOCK_AUTH). The pool's MFA
// is OPTIONAL with TOTP only (no SMS): any user may turn it on; the admin API requires it of admins when the stack's
// adminMfa flag is on (api/lib/admins.py, 403 MFA_REQUIRED). Once on, every sign-in asks for a code:
// Auth.login answers { done: false, nextStep: TOTP_SIGN_IN_STEP } and TotpCodeForm (totp.tsx) finishes the sign-in.

/** Auth.login's nextStep when the account has an authenticator app: finish with confirmTotpSignIn. */
export const TOTP_SIGN_IN_STEP = 'CONFIRM_SIGN_IN_WITH_TOTP_CODE';

/** Finish a sign-in that asked for an authenticator code. True when signed in. */
export async function confirmTotpSignIn(code: string): Promise<boolean> {
  const out = await confirmSignIn({ challengeResponse: code.replace(/\s/g, '') });
  return out.isSignedIn;
}

/** Start adding an authenticator app for the signed-in user: the secret and the otpauth:// URI (shown as a QR code).
 *  `issuer` is the name the app lists (the site's name), `account` usually the email. */
export async function startTotpSetup(issuer: string, account: string): Promise<{ secret: string; uri: string }> {
  const details = await setUpTOTP();
  return { secret: details.sharedSecret, uri: details.getSetupUri(issuer, account).toString() };
}

/** Check a code from the newly added app and turn TOTP on (preferred) for the signed-in user. */
export async function finishTotpSetup(code: string): Promise<void> {
  await verifyTOTPSetup({ code: code.replace(/\s/g, '') });
  await updateMFAPreference({ totp: 'PREFERRED' });
}

/** Whether the signed-in user has an authenticator app turned on. */
export async function totpEnabled(): Promise<boolean> {
  const pref = await fetchMFAPreference();
  return !!pref.enabled?.includes('TOTP');
}

/** Turn the signed-in user's authenticator app off (an admin then can't use the admin site until they add one again). */
export async function disableTotp(): Promise<void> {
  await updateMFAPreference({ totp: 'DISABLED' });
}
