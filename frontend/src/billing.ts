import { useEffect, useState } from 'react';
import { fetchPublicConfig } from './api';
import type { PublicConfig } from './types';

/** Which billing modules are on (the API's BILLING_MODE, from cdk.json context billingMode). Pages and nav items of a
 *  module that is off are hidden; its API routes answer 404 anyway. Money formatting is shared with the admin site. */
export { creditsOn, shortDate, subscriptionsOn, units, usd } from '@yourapp/shared';

let pending: Promise<PublicConfig> | null = null;

/** GET /api/public-config once per page load (retried after a failure). */
export function loadPublicConfig(): Promise<PublicConfig> {
  if (!pending) {
    pending = fetchPublicConfig().catch((e) => {
      pending = null;
      throw e;
    });
  }
  return pending;
}

/** The public config, or null until it loads (or when there is no API, as with MOCK_AUTH). */
export function usePublicConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    let live = true;
    loadPublicConfig().then((c) => live && setConfig(c)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return config;
}
