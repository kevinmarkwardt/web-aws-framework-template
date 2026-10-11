import { createContext, useContext } from 'react';
import type { AdminMe } from './types';

/** The signed-in admin and what the site sells (GET /api/admin/me), for every tab. */
export const MeContext = createContext<AdminMe | null>(null);

export function useMe(): AdminMe {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside the signed-in admin layout');
  return me;
}

/** The user site's URL (the API's SITE_URL, or the build's VITE_SITE_URL). */
export const siteUrl = (me: AdminMe) => me.siteUrl || import.meta.env.VITE_SITE_URL || '';

/** Link to a user's detail on the Users tab. */
export const userLink = (userId: string) => `/users?user=${encodeURIComponent(userId)}`;
