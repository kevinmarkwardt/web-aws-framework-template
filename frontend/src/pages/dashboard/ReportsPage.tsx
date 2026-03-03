import { useContext } from 'react';
import { AuthContext } from '../../App';
import { createCheckoutSession } from '../../api';

export default function ReportsPage() {
  const { user } = useContext(AuthContext);
  const isPro = user?.plan === 'pro';

  const handleUpgrade = async () => {
    try {
      const { url } = await createCheckoutSession('pro');
      window.location.href = url;
    } catch {
      // Error handled by api
    }
  };

  if (!isPro) {
    return (
      <div className="text-center py-24">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Monthly Reports</h2>
        <p className="text-gray-600 mb-6 max-w-md mx-auto">
          Get monthly PDF reports with detailed breakdowns and trend analysis.
          Available on the Pro plan.
        </p>
        <button
          onClick={handleUpgrade}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
        >
          Upgrade to Pro ($19/mo)
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500 mt-1">
          Monthly reports archived here
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
        <p className="text-gray-500 text-sm">
          No reports generated yet. Your first report will appear on the 1st of next month.
        </p>
      </div>
    </div>
  );
}
