// __Entities__ API client (the contract: packages/shared/src/contracts/__entity__.ts). The browser mocks answer while
// __plural__ is mocked (packages/shared/src/mocks/mocks.config.ts); the real API afterwards. Same calls either way.
import { __contract__ } from '@yourapp/shared/contracts';
import type { __Entity__, __Entity__Input } from '@yourapp/shared/contracts';
import { siteApi } from '../client';

export const __entities__Api = siteApi<__Entity__, __Entity__Input>(__contract__);
