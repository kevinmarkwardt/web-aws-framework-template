import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../App';
import type { Link } from '../../types';
import { fetchLinks, deleteLink, recrawlLink } from '../../api';
import AddLinkForm from '../../components/AddLinkForm';
import BulkPasteModal from '../../components/BulkPasteModal';
import CSVUploadModal from '../../components/CSVUploadModal';
import LinksTable from '../../components/LinksTable';
import UpgradeBanner from '../../components/UpgradeBanner';

export default function LinksPage() {
  const { user } = useContext(AuthContext);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);

  useEffect(() => {
    fetchLinks()
      .then(setLinks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAdded = (link: Link) => {
    setLinks((prev) => [link, ...prev]);
  };

  const handleBulkAdded = (newLinks: Link[]) => {
    setLinks((prev) => [...newLinks, ...prev]);
  };

  const handleDelete = async (linkId: string) => {
    try {
      await deleteLink(linkId);
      setLinks((prev) => prev.filter((l) => l.linkId !== linkId));
    } catch {
      // Error handled by api
    }
  };

  const handleRecrawl = async (linkId: string) => {
    try {
      const updated = await recrawlLink(linkId);
      setLinks((prev) => prev.map((l) => (l.linkId === linkId ? updated : l)));
    } catch {
      // Error handled by api
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Links</h1>
        <p className="text-sm text-gray-500 mt-1">
          {links.length} link{links.length !== 1 ? 's' : ''} monitored
        </p>
      </div>

      {user && <UpgradeBanner plan={user.plan} linkCount={links.length} />}

      <AddLinkForm
        onAdded={handleAdded}
        onOpenBulk={() => setBulkOpen(true)}
        onOpenCSV={() => setCsvOpen(true)}
      />

      <LinksTable
        links={links}
        onDelete={handleDelete}
        isPro={user?.plan === 'pro'}
        onRecrawl={handleRecrawl}
      />

      <BulkPasteModal open={bulkOpen} onClose={() => setBulkOpen(false)} onAdded={handleBulkAdded} />
      <CSVUploadModal open={csvOpen} onClose={() => setCsvOpen(false)} onAdded={handleBulkAdded} />
    </div>
  );
}
