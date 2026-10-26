import { defineConfig } from 'vitest/config';

// The toolkit's own unit tests; access_inspector/run.spec.ts only runs inside a project.
export default defineConfig({ test: { include: ['tests/**/*.spec.ts'] } });
