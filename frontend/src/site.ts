/** The site's public identity, filled into texts such as the Terms and Privacy pages (locales/{lang}/legal.json uses
 *  {{displayName}}, {{domain}} and {{contactEmail}}). scripts/init.sh replaces the placeholders. */
export const SITE = {
  displayName: 'YourApp',
  domain: 'yourapp.com',
  contactEmail: 'support@yourapp.com',
  /** The date the Terms and Privacy texts last changed (shown on both pages). Change it with the text. */
  legalUpdated: '2026-10-11T12:00:00Z',
};
