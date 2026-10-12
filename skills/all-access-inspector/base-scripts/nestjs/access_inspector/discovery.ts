// Enumerate every route the app serves: Nest's own, as its snapshot graph records them, then any route mounted
// on Express outside Nest.

import type { INestApplication } from '@nestjs/common';

import { join, normalize } from './paths.js';

export interface RawEndpoint {
  method: string;
  path: string;
  handler: string;
  controller?: Function; // unset outside Nest
  methodName?: string;
  reason?: string; // set when the script cannot read the route's access checks
}

/** What the boot saw on Express: router mount paths and the route layers Nest middleware registered. */
export interface Watched {
  mounts: Map<unknown, string>;
  middleware: Set<unknown>;
}

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Function }[] };
  handle?: { stack?: Layer[] };
}

interface ExpressApp {
  use: (...args: unknown[]) => unknown;
  router?: { stack: Layer[] };
  _router?: { stack: Layer[] };
}

interface Adapter {
  getType(): string;
  getInstance(): ExpressApp;
  createMiddlewareFactory(method: unknown): (path: string, callback: Function) => unknown;
}

interface Entrypoint {
  type: string;
  methodName: string;
  className: string;
  classNodeId: string;
  metadata: { path: string; requestMethod: string };
}

interface Container {
  serializedGraph: { toJSON(): { entrypoints: Record<string, Entrypoint[]> } };
  getModules(): Map<string, { controllers: Map<unknown, { id: string; metatype: Function }> }>;
}

const OUTSIDE = 'mounted on Express outside Nest; its access checks are not readable';

const stack = (app: ExpressApp): Layer[] => (app.router ?? app._router)?.stack ?? [];

/** Called before the project's setup runs, so every app.use(path, router) and Nest middleware route is seen. */
export const watch = (app: INestApplication): Watched => {
  const watched: Watched = { mounts: new Map(), middleware: new Set() };
  const adapter = app.getHttpAdapter() as unknown as Adapter;
  if (adapter.getType() !== 'express') return watched;
  const instance = adapter.getInstance();
  const use = instance.use;
  instance.use = function (this: unknown, ...args: unknown[]) {
    if (typeof args[0] === 'string') for (const handler of args.slice(1)) watched.mounts.set(handler, args[0]);
    return use.apply(this, args);
  };
  const factory = adapter.createMiddlewareFactory.bind(adapter);
  adapter.createMiddlewareFactory = method => {
    const register = factory(method);
    return (path, callback) => {
      const before = new Set(stack(instance));
      const result = register(path, callback);
      for (const layer of stack(instance)) if (!before.has(layer)) watched.middleware.add(layer);
      return result;
    };
  };
  return watched;
};

export const discover = (app: INestApplication, watched: Watched): RawEndpoint[] => {
  const container = (app as unknown as { container: Container }).container;
  const controllers = new Map<string, Function>();
  for (const module of container.getModules().values()) {
    for (const wrapper of module.controllers.values()) controllers.set(wrapper.id, wrapper.metatype);
  }
  const nest = Object.values(container.serializedGraph.toJSON().entrypoints)
    .flat()
    .filter(e => e.type === 'http-endpoint')
    .map(
      (e): RawEndpoint => ({
        method: e.metadata.requestMethod === 'ALL' ? 'ANY' : e.metadata.requestMethod,
        path: normalize(e.metadata.path),
        handler: `${e.className}.${e.methodName}`,
        controller: controllers.get(e.classNodeId)!,
        methodName: e.methodName,
      }),
    );
  const adapter = app.getHttpAdapter() as unknown as Adapter;
  const outside = adapter.getType() === 'express' ? express(stack(adapter.getInstance()), '', nest, watched) : [];
  return withHead(dedupe([...nest, ...outside]));
};

const express = (layers: Layer[], prefix: string, nest: RawEndpoint[], watched: Watched): RawEndpoint[] =>
  layers.flatMap(layer => {
    if (layer.route !== undefined) {
      if (watched.middleware.has(layer)) return [];
      const path = join(prefix, layer.route.path);
      const handler = layer.route.stack.at(-1)?.handle.name || '<anonymous>';
      return Object.keys(layer.route.methods)
        .map(m => (m === '_all' ? 'ANY' : m.toUpperCase()))
        .filter(method => !nest.some(e => e.method === method && e.path === path))
        .map(method => ({ method, path, handler, reason: OUTSIDE }));
    }
    const router = layer.handle;
    if (!Array.isArray(router?.stack)) return []; // middleware: not an endpoint
    const mount = watched.mounts.get(router);
    return express(router.stack, join(prefix, mount ?? '{mount}'), nest, watched);
  });

const key = (e: RawEndpoint): string => `${e.method} ${e.path} ${e.handler}`;

const dedupe = (endpoints: RawEndpoint[]): RawEndpoint[] => [...new Map(endpoints.map(e => [key(e), e])).values()];

/** Express answers HEAD through the GET handler, guards included, unless a HEAD route is declared. */
const withHead = (endpoints: RawEndpoint[]): RawEndpoint[] => [
  ...endpoints,
  ...endpoints
    .filter(e => e.method === 'GET' && !endpoints.some(h => h.method === 'HEAD' && h.path === e.path))
    .map(e => ({ ...e, method: 'HEAD' })),
];
