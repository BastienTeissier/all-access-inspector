import { join } from 'node:path';

import type { NextConfig } from 'next';

// The app imports the review package by relative path (../../skills/all-access-inspector/review/src), so the repo root is the root.
const root = join(import.meta.dirname, '..', '..');

const config: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default config;
