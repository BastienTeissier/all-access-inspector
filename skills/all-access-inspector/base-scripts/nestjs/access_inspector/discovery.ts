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

/** What the boot saw on Express: router mount paths, and the layers Nest adds that serve no endpoint. */
export interface Watched {
  mounts: Map<unknown, string[]>; // a router's mount paths; '' when mounted without one
  internal: Set<unknown>; // middleware routes and the not-found handler
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
  setNotFoundHandler(...args: unknown[]): unknown;
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
const NO_CONTROLLER = 'controller not found in the Nest container; its guards are not readable';

// Express 4 keeps the router in _router, and its app.router getter throws; Express 5 has only app.router.
const stack = (app: ExpressApp): Layer[] => (app._router ?? app.router)?.stack ?? [];

/** Called before the project's setup runs, so every app.use(path, router) and Nest internal layer is seen. */
export const watch = (app: INestApplication): Watched => {
  const watched: Watched = { mounts: new Map(), internal: new Set() };
  const adapter = app.getHttpAdapter() as unknown as Adapter;
  if (adapter.getType() !== 'express') return watched;
  const instance = adapter.getInstance();
  const use = instance.use;
  instance.use = function (this: unknown, ...args: unknown[]) {
    const [first, ...rest] = args;
    const paths = typeof first === 'string' ? [first] : Array.isArray(first) ? first.map(String) : [''];
    for (const handler of typeof first === 'function' ? args : rest) {
      watched.mounts.set(handler, [...new Set([...(watched.mounts.get(handler) ?? []), ...paths])]);
    }
    return use.apply(this, args);
  };
  const internal = <A extends unknown[]>(register: (...args: A) => unknown) => (...args: A) => {
    const before = new Set(stack(instance));
    const result = register(...args);
    for (const layer of stack(instance)) if (!before.has(layer)) watched.internal.add(layer);
    return result;
  };
  const factory = adapter.createMiddlewareFactory.bind(adapter);
  adapter.createMiddlewareFactory = method => internal(factory(method));
  adapter.setNotFoundHandler = internal(adapter.setNotFoundHandler.bind(adapter));
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
    .map((e): RawEndpoint => {
      const controller = controllers.get(e.classNodeId);
      return {
        method: e.metadata.requestMethod === 'ALL' ? 'ANY' : e.metadata.requestMethod,
        path: normalize(e.metadata.path),
        handler: `${e.className}.${e.methodName}`,
        methodName: e.methodName,
        ...(controller === undefined ? { reason: NO_CONTROLLER } : { controller }),
      };
    });
  const adapter = app.getHttpAdapter() as unknown as Adapter;
  const outside = adapter.getType() === 'express' ? express(stack(adapter.getInstance()), '', nest, watched) : [];
  return withHead(dedupe([...nest, ...outside]));
};

const express = (layers: Layer[], prefix: string, nest: RawEndpoint[], watched: Watched): RawEndpoint[] =>
  layers.flatMap(layer => {
    if (watched.internal.has(layer)) return [];
    if (layer.route !== undefined) {
      const path = join(prefix, layer.route.path);
      const handler = layer.route.stack.at(-1)?.handle.name || '<anonymous>';
      return Object.keys(layer.route.methods)
        .map(m => (m === '_all' ? 'ANY' : m.toUpperCase()))
        .filter(method => !nest.some(e => (e.method === method || e.method === 'ANY') && e.path === path))
        .map(method => ({ method, path, handler, reason: OUTSIDE }));
    }
    const router = layer.handle;
    if (!Array.isArray(router?.stack)) return []; // middleware: not an endpoint
    const mounts = watched.mounts.get(router) ?? ['{mount}'];
    return mounts.flatMap(mount => express(router.stack!, join(prefix, mount), nest, watched));
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
