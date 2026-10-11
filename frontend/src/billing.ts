import { useEffect, useState } from 'react';
import { fetchPublicConfig } from './api';
import type { BillingMode, PublicConfig } from './types';

/** Which billing modules are on (the API's BILLING_MODE, from cdk.json context billingMode). Pages and nav items of a
 *  module that is off are hidden; its API routes answer 404 anyway. */
export const subscriptionsOn = (mode?: BillingMode) => mode === 'subscriptions' || mode === 'both';
export const creditsOn = (mode?: BillingMode) => mode === 'credits' || mode === 'both';

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

export const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "1,250 credits" (the unit name is config creditName). */
export const units = (n: number, name = 'credits') => `${n.toLocaleString()} ${name}`;

export const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');
