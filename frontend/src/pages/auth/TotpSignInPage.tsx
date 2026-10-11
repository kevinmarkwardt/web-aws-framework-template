import { TotpCodeForm } from '@yourapp/shared';

/** The second sign-in step for an account with an authenticator app (admins when adminMfa is on, or any user who added
 *  one: the user pool's MFA is optional, TOTP only). LoginPage shows it when Cognito asks for the code. */
export default function TotpSignInPage({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="text-center text-2xl font-bold text-gray-900">Two-step sign-in</h2>
      </div>
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm sm:rounded-xl sm:px-10 border border-gray-200">
          <TotpCodeForm onDone={onDone} onCancel={onCancel} />
        </div>
      </div>
    </div>
  );
}
