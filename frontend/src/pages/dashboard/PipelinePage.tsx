import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../App';
import type { Pitch } from '../../types';
import { fetchPitches } from '../../api';
import { createCheckoutSession } from '../../api';
import PipelineTable from '../../components/PipelineTable';
import AddPitchModal from '../../components/AddPitchModal';

export default function PipelinePage() {
  const { user } = useContext(AuthContext);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const isLocked = user?.plan === 'free';

  useEffect(() => {
    if (isLocked) {
      setLoading(false);
      return;
    }
    fetchPitches()
      .then(setPitches)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isLocked]);

  const handleUpgrade = async () => {
    try {
      const { url } = await createCheckoutSession('starter');
      window.location.href = url;
    } catch {
      // Error handled by api
    }
  };

  if (isLocked) {
    return (
      <div className="text-center py-24">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Pipeline Tracker</h2>
        <p className="text-gray-600 mb-6 max-w-md mx-auto">
          Track your guest post outreach from pitch to publication. Available on Starter and Pro plans.
        </p>
        <button
          onClick={handleUpgrade}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
        >
          Upgrade to Starter ($9/mo)
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track guest post outreach from pitch to publication
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
        >
          Add Pitch
        </button>
      </div>

      <PipelineTable
        pitches={pitches}
        onUpdate={(updated) =>
          setPitches((prev) =>
            prev.map((p) => (p.pitchId === updated.pitchId ? updated : p))
          )
        }
        onDelete={(pitchId) =>
          setPitches((prev) => prev.filter((p) => p.pitchId !== pitchId))
        }
      />

      <AddPitchModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(pitch) => setPitches((prev) => [pitch, ...prev])}
      />
    </div>
  );
}
