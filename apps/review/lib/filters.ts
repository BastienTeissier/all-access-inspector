// The queue's filters as URL search params: the page reads them, the Verdict form sends them back.

import type { Filters } from './projection.ts';

export const FILTERS = ['zone', 'tier', 'signal', 'state', 'q', 'view'] as const;

export const filtersOf = (params: URLSearchParams): Filters =>
  Object.fromEntries(FILTERS.flatMap(k => (params.get(k) ? [[k, params.get(k)!]] : [])));

/** The page's URL with `filters`, and the endpoint `e` open when given. */
export const href = (filters: Filters, e?: string): string => {
  const params = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
  if (e) params.set('e', e);
  const text = params.toString();
  return text ? `/?${text}` : '/';
};

/** The project the app reviews: `review app` passes it, absolute. */
export const projectDir = (): string => {
  const dir = process.env.REVIEW_PROJECT;
  if (!dir) throw new Error('REVIEW_PROJECT is not set: start the app with `review app <project>`');
  return dir;
};
