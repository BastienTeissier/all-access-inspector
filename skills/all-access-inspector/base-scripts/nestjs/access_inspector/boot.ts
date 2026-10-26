// The pinned Boot Environment: root module, HTTP setup, environment and stubs, each with its reason.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { posix } from 'node:path';

import { type Watched, watch } from './discovery.js';
import type { BootEnvironment } from './inventory.js';

export const ROOT = process.cwd(); // inspect.sh runs from the directory that holds package.json and tools/
export const HERE = 'tools/access-inspector';

/** A module export, its specifier relative to this file as main.ts would import it. */
export interface Export {
  module: string;
  export: string;
}

export interface Env {
  name: string; // environment variable, set before ENTRY is imported and overriding the shell and .env files
  value: string;
  reason: string;
}

export interface Stub {
  token: unknown; // provider token, as overrideProvider() takes it
  reason: string;
  value: unknown;
}

export class BootError extends Error {}

// --- project ---
// The root module main.ts boots.
export const ENTRY: Export = { module: '../../src/app.module.js', export: 'AppModule' };

// The HTTP setup main.ts applies to the app (global prefix, versioning, useGlobalGuards, app.use), or null, e.g.:
// { module: '../../src/configure-app.js', export: 'configureApp' }
export const CONFIGURE: Export | null = null;

// Production values of the environment variables the app reads at import or boot; NODE_ENV is required, e.g.:
// { name: 'JWT_SECRET', value: 'inventory-placeholder-…', reason: 'secret required at boot by src/config/env.ts' },
export const ENVIRON: Env[] = [{ name: 'NODE_ENV', value: 'production', reason: 'production value' }];

// Toward production only: providers reaching secrets, databases and external services, never a guard, a controller
// or the entry module, e.g.:
// { token: DATABASE, reason: 'database unreachable outside production', value: {} },
export const STUBS: Stub[] = [];
// --- end project ---

export interface Booted {
  app: INestApplication;
  environment: BootEnvironment;
  watched: Watched;
}

export const checkEnviron = (environ: Env[]): void => {
  const names = environ.map(e => e.name);
  for (const env of environ) {
    if (!env.name || env.name.includes('=')) throw new BootError(`environment variable name '${env.name}' is not valid`);
    if (names.filter(n => n === env.name).length > 1) throw new BootError(`environment variable ${env.name} is set twice`);
    if (typeof env.value !== 'string') throw new BootError(`environment variable ${env.name} value must be a string`);
    if (!env.reason) throw new BootError(`environment variable ${env.name} needs a reason`);
  }
  if (!environ.some(e => e.name === 'NODE_ENV' && e.value === 'production')) {
    throw new BootError('NODE_ENV must be production');
  }
};

export const checkStubs = (stubs: Stub[], entry: unknown): void => {
  for (const stub of stubs) {
    const token = stub.token as { prototype?: { canActivate?: unknown } } | undefined;
    const shaping =
      stub.token === entry ||
      stub.token === 'APP_GUARD' ||
      typeof token?.prototype?.canActivate === 'function' ||
      (typeof stub.token === 'function' && Reflect.getMetadata('__controller__', stub.token) === true);
    if (shaping) throw new BootError(`access-shaping provider ${tokenName(stub.token)} may not be stubbed`);
    if (!stub.reason) throw new BootError(`stub ${tokenName(stub.token)} needs a reason`);
  }
};

export const tokenName = (token: unknown): string =>
  typeof token === 'function' ? token.name : typeof token === 'symbol' ? (token.description ?? 'Symbol()') : String(token);

export const exportName = (e: Export): string =>
  `${e.module.startsWith('.') ? posix.normalize(posix.join(HERE, e.module)) : e.module}#${e.export}`;

const load = async (e: Export): Promise<unknown> => {
  const module = (await import(e.module)) as Record<string, unknown>;
  if (module[e.export] === undefined) throw new Error(`${e.module} exports no ${e.export}`);
  return module[e.export];
};

/** Boot the root module as main.ts does, without listening. */
export const boot = async (): Promise<Booted> => {
  checkEnviron(ENVIRON);
  for (const env of ENVIRON) process.env[env.name] = env.value;
  const entry = exportName(ENTRY);
  try {
    const root = await load(ENTRY);
    checkStubs(STUBS, root);
    let builder = Test.createTestingModule({ imports: [root as never] });
    for (const stub of STUBS) builder = builder.overrideProvider(stub.token).useValue(stub.value);
    // The snapshot graph records each route as Nest resolved it: prefix, versioning and RouterModule applied.
    const moduleRef = await builder.compile({ snapshot: true });
    const app = moduleRef.createNestApplication({ logger: false });
    const watched = watch(app);
    if (CONFIGURE !== null) await (await load(CONFIGURE) as (app: INestApplication) => unknown)(app);
    await app.init();
    return {
      app,
      watched,
      environment: {
        entry,
        environ: ENVIRON.map(e => ({ name: e.name, value: e.value, reason: e.reason })),
        stubs: STUBS.map(s => ({ target: tokenName(s.token), reason: s.reason })),
        pinned: [],
      },
    };
  } catch (error) {
    if (error instanceof BootError) throw error;
    const { name, message } = error instanceof Error ? error : new Error(String(error));
    throw new BootError(`cannot boot root module ${entry}: ${name}: ${message}`, { cause: error });
  }
};
