// @yourapp/shared/contracts: the entity contracts (one file per entity, written by scripts/new-entity.py) and what
// works on them. See types.ts for the HTTP contract every entity follows.
import { CONTRACTS } from './all.gen';
import type { EntityContract } from './types';

export * from './types';
export * from './all.gen';
export { checkField, pickFields, validateBody } from './validate';
export type { FieldError } from './validate';
export { QueryError, listSearch, runQuery } from './query';

/** The contract of entity `name` (PascalCase), if it has one. */
export const contractByName = (name: string): EntityContract | undefined => CONTRACTS.find((c) => c.name === name);

/** The entities with a ref field pointing at `name`: [{ contract, field }] (a Chef page lists its Recipes). */
export const referencing = (name: string): { contract: EntityContract; field: string }[] =>
  CONTRACTS.flatMap((c) => c.fields.filter((f) => f.type === 'ref' && f.ref === name).map((f) => ({ contract: c, field: f.name })));
