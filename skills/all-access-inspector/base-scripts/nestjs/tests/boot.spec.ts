import { Controller } from '@nestjs/common';
import { expect, test } from 'vitest';

import { type Env, checkEnviron, checkStubs, exportName, tokenName } from '../access_inspector/boot.js';

const production: Env = { name: 'NODE_ENV', value: 'production', reason: 'production value' };

test.each<[Env[], string]>([
  [[], 'NODE_ENV must be production'],
  [[{ ...production, value: 'development' }], 'NODE_ENV must be production'],
  [[production, { name: 'A=B', value: 'x', reason: 'r' }], "name 'A=B' is not valid"],
  [[production, { name: '', value: 'x', reason: 'r' }], "name '' is not valid"],
  [[production, production], 'NODE_ENV is set twice'],
  [[production, { name: 'PORT', value: 3000 as never, reason: 'r' }], 'PORT value must be a string'],
  [[production, { name: 'PORT', value: '3000', reason: '' }], 'PORT needs a reason'],
])('environ %j', (environ, message) => expect(() => checkEnviron(environ)).toThrow(message));

test('environ accepts production', () => checkEnviron([production]));

class AppModule {}
class DatabaseService {}
class RolesGuard {
  canActivate(): boolean {
    return true;
  }
}
class OrdersController {}
Controller('orders')(OrdersController);

test.each<[unknown, string]>([
  [AppModule, 'AppModule'],
  ['APP_GUARD', 'APP_GUARD'],
  [RolesGuard, 'RolesGuard'],
  [OrdersController, 'OrdersController'],
])('stub %s is refused', (token, name) =>
  expect(() => checkStubs([{ token, reason: 'r', value: {} }], AppModule)).toThrow(`access-shaping provider ${name} may not be stubbed`),
);

test('a stub needs a reason', () => {
  expect(() => checkStubs([{ token: DatabaseService, reason: '', value: {} }], AppModule)).toThrow('stub DatabaseService needs a reason');
  checkStubs([{ token: DatabaseService, reason: 'database', value: {} }, { token: Symbol('REDIS'), reason: 'cache', value: {} }], AppModule);
});

test('names', () => {
  expect(tokenName(Symbol('REDIS'))).toBe('REDIS');
  expect(tokenName('CONFIG')).toBe('CONFIG');
  expect(exportName({ module: '../../src/app.module.js', export: 'AppModule' })).toBe('src/app.module.js#AppModule');
  expect(exportName({ module: '@acme/api', export: 'ApiModule' })).toBe('@acme/api#ApiModule');
});
