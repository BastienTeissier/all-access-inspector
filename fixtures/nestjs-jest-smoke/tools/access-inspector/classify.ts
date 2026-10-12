// Read the guards each endpoint runs, in request order: global, controller, handler.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';

import type { RawEndpoint } from './discovery.js';
import type { Layer } from './inventory.js';
import { type Finding, type Metadata, NO_CHECK, PASSPORT, isNeutral } from './rules.js';

const GUARDS = '__guards__'; // GUARDS_METADATA, whose import path moved between Nest versions

export interface Classified {
  findings: Finding[];
  metadata: Metadata;
}

interface Config {
  getGlobalGuards(): unknown[];
  getGlobalRequestGuards(): { metatype: unknown }[];
}

/** @nestjs/passport's AuthGuard(type) is a memoized mixin with a random name: map each one to its raw form. */
export const passportGuards = async (): Promise<Map<unknown, string>> => {
  const load = async (name: string): Promise<Record<string, unknown> | null> => {
    try {
      return (await import(name)) as Record<string, unknown>;
    } catch {
      return null; // not installed: the project uses no passport guard
    }
  };
  const nest = await load('@nestjs/passport');
  const passport = (await load('passport')) as { default?: { _strategies?: object }; _strategies?: object } | null;
  if (typeof nest?.AuthGuard !== 'function') return new Map();
  const authGuard = nest.AuthGuard as (type?: string) => unknown;
  const names = Object.keys((passport?.default ?? passport)?._strategies ?? {}).filter(n => n !== 'session');
  return new Map([
    [authGuard(), 'AuthGuard()'],
    ...names.map((n): [unknown, string] => [authGuard(n), `AuthGuard('${n}')`]),
  ]);
};

export const classify = (raw: RawEndpoint, app: INestApplication, passport: Map<unknown, string>): Classified => {
  if (raw.reason !== undefined || raw.controller === undefined || raw.methodName === undefined) {
    return { findings: [{ construct: raw.handler, layer: null, raw: raw.handler, reason: raw.reason }], metadata: {} };
  }
  const config = (app as unknown as { container: { applicationConfig: Config } }).container.applicationConfig;
  const controller = raw.controller;
  const handler = (controller.prototype as Record<string, Function>)[raw.methodName]!;
  const guards: [unknown, Layer][] = [
    ...config.getGlobalGuards().map((g): [unknown, Layer] => [g, 'global']),
    ...config.getGlobalRequestGuards().map((w): [unknown, Layer] => [w.metatype, 'global']),
    ...((Reflect.getMetadata(GUARDS, controller) ?? []) as unknown[]).map((g): [unknown, Layer] => [g, 'class']),
    ...((Reflect.getMetadata(GUARDS, handler) ?? []) as unknown[]).map((g): [unknown, Layer] => [g, 'method']),
  ];
  const findings = guards.map(([g, layer]) => finding(g, layer, passport)).filter(f => !isNeutral(f.construct));
  return {
    findings: findings.length > 0 ? findings : [{ construct: NO_CHECK, layer: 'framework-default', raw: null }],
    metadata: metadata(controller, handler),
  };
};

const finding = (guard: unknown, layer: Layer, passport: Map<unknown, string>): Finding => {
  const type = typeof guard === 'function' ? guard : (guard as object).constructor;
  const raw = passport.get(type);
  return raw === undefined ? { construct: type.name, layer, raw: type.name } : { construct: PASSPORT, layer, raw };
};

/** Every metadata key on the class and the handler; the handler wins, as Reflector.getAllAndOverride reads them. */
const metadata = (controller: Function, handler: Function): Metadata => {
  const read = (target: Function): Metadata =>
    Object.fromEntries(
      Reflect.getMetadataKeys(target).map(k => [String(k), Reflect.getMetadata(k, target) as unknown]),
    );
  const own = Object.entries(read(handler)).filter(([, v]) => v !== undefined);
  return { ...read(controller), ...Object.fromEntries(own) };
};
