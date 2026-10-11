// @yourapp/shared: what the user site (frontend/) and the admin site (admin/) both use. Imported as TypeScript source;
// each app's Vite build compiles it. The theme tokens are src/theme.css (each app's index.css imports it). Texts are
// src/locales/{lang}/{area}.json (CLAUDE.md, "i18n").
export { ApiError, ErrorCodes, createApiClient, del, post, put, qs } from './api';
export type { ApiClientOptions, ApiFetch } from './api';
export { MOCK_AUTH, createAuth } from './auth';
export type { Auth, AuthOptions } from './auth';
export { bytes, dateTime, num, shiftDay, shortDate, units, usd, utcToday } from './format';
export { useLoad } from './hooks';
export type { Loaded } from './hooks';
export {
  Badge, Button, DataTable, Dialog, Drawer, Empty, Field, Input, JsonBlock, Loading, Notice, PageHeader, Panel, Select,
  Spinner, Stat, Textarea, Toggle,
} from './ui';
export type { Column } from './ui';
export type { AccountStatus, BillingMode } from './types';
export { creditsOn, subscriptionsOn } from './types';
// i18n: each site first imports '@yourapp/shared/i18n/site' or '/i18n/admin' (it sets i18next up with that site's texts)
export { DEFAULT_LANGUAGE, LANGUAGES, LANGUAGE_CODES, supportedLanguage } from './i18n/languages';
export { currentLanguage, i18n, languageChosen, switchLanguage } from './i18n/setup';
export { LanguagePicker } from './i18n/LanguagePicker';
export { Trans, useTranslation } from 'react-i18next';
