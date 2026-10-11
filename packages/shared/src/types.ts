/** Which billing modules are on (the API's BILLING_MODE, cdk.json context billingMode). */
export type BillingMode = 'none' | 'subscriptions' | 'credits' | 'both';
export type AccountStatus = 'active' | 'suspended' | 'banned';

export const subscriptionsOn = (mode?: BillingMode | null) => mode === 'subscriptions' || mode === 'both';
export const creditsOn = (mode?: BillingMode | null) => mode === 'credits' || mode === 'both';
