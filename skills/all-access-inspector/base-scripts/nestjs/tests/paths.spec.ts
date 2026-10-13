import { expect, test } from 'vitest';

import { join, normalize } from '../access_inspector/paths.js';

test.each([
  ['users/:id', '/users/{id}'],
  ['/v1/users/:userId/posts/:postId', '/v1/users/{userId}/posts/{postId}'],
  ['/files/*path', '/files/{path}'],
  ['/legacy/*', '/legacy/{wildcard}'],
  ['/orders/:id(\\d+)', '/orders/{id}'],
  ['//api//health', '/api/health'],
  ['/users/', '/users/'],
  ['/', '/'],
  ['files/{*path}', '/files/{path}'],
  ['users{/:id}', '/users/{id}'],
  ['/a{/:b{/:c}}', '/a/{b}/{c}'],
  ['/users/{id}', '/users/{id}'],
])('normalize %s', (path, expected) => expect(normalize(path)).toBe(expected));

test.each([
  ['', '/ping', '/ping'],
  ['/legacy', '/ping', '/legacy/ping'],
  ['/legacy', '/', '/legacy'],
  ['/legacy/', ':id', '/legacy/{id}'],
])('join %s %s', (prefix, path, expected) => expect(join(prefix, path)).toBe(expected));
