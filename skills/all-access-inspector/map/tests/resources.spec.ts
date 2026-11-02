import { describe, expect, test } from 'vitest';

import { capabilityList } from '../src/cells.ts';
import type { MapEndpoint } from '../src/join.ts';
import { resources } from '../src/resources.ts';
import { at, firstParty, runtime, vocabulary } from './fixtures.ts';

const derive = (...endpoints: MapEndpoint[]) => resources(endpoints, firstParty);
const ids = (...endpoints: MapEndpoint[]) => derive(...endpoints).map(c => c.id);

const invoices = [
  at('GET', '/api/invoices/'),
  at('POST', '/api/invoices/'),
  at('GET', '/api/invoices/{pk}/'),
  at('PUT', '/api/invoices/{pk}/'),
  at('PATCH', '/api/invoices/{pk}/'),
  at('DELETE', '/api/invoices/{pk}/'),
];

describe('resources', () => {
  test('a collection with a detail sibling is a resource, one capability per verb, named by its segment as is', () => {
    expect(derive(...invoices).map(c => [c.id, c.name, c.area, c.verb, c.endpoints.length])).toEqual([
      ['resource.api.invoices.list', 'List invoices', 'api.invoices', 'read', 1],
      ['resource.api.invoices.read', 'Read invoices', 'api.invoices', 'read', 1],
      ['resource.api.invoices.create', 'Create invoices', 'api.invoices', 'write', 1],
      ['resource.api.invoices.update', 'Update invoices', 'api.invoices', 'write', 2],
      ['resource.api.invoices.delete', 'Delete invoices', 'api.invoices', 'write', 1],
    ]);
    expect(derive(...invoices)[0]).toMatchObject({ basis: 'inferred', derived: 'resource', term: null, at: null, check: 'signed_in' });
  });

  test('a collection with no detail, or a detail with no collection, is no resource', () => {
    expect(ids(at('GET', '/api/invoices/'), at('GET', '/api/invoices/export/'))).toEqual([]);
    expect(ids(at('GET', '/api/orders/{pk}/'), at('POST', '/api/orders/{pk}/refund/'))).toEqual([]);
  });

  test('the prefix keeps two versions of a resource apart', () => {
    expect(ids(at('GET', '/v1/items'), at('GET', '/v1/items/{id}'), at('GET', '/v2/items'), at('GET', '/v2/items/{id}'))).toEqual([
      'resource.v1.items.list',
      'resource.v1.items.read',
      'resource.v2.items.list',
      'resource.v2.items.read',
    ]);
  });

  test('prefixes that differ only by a parameter are one resource', () => {
    const items = derive(at('GET', '/api/items/'), at('GET', '/api/items/{id}/'), at('GET', '/api/{version}/items/'), at('GET', '/api/{version}/items/{id}/'));
    expect(items.map(c => [c.id, c.endpoints.length])).toEqual([
      ['resource.api.items.list', 2],
      ['resource.api.items.read', 2],
    ]);
  });

  test('an action named like a verb joins that verb, and a write makes it write', () => {
    const list = derive(at('GET', '/x/'), at('GET', '/x/{id}/'), at('POST', '/x/{id}/list/')).find(c => c.id === 'resource.x.list');
    expect(list).toMatchObject({ name: 'List x', verb: 'write', endpoints: [['GET', '/x/', 'app/views.py'], ['POST', '/x/{id}/list/', 'app/views.py']] });
  });

  test('an action under a detail path is its own capability, named by its segment', () => {
    const refund = derive(...invoices, at('POST', '/api/invoices/{pk}/refund/'), at('GET', '/api/invoices/{pk}/pdf/')).slice(-2);
    expect(refund.map(c => [c.id, c.name, c.verb])).toEqual([
      ['resource.api.invoices.pdf', 'Pdf', 'read'],
      ['resource.api.invoices.refund', 'Refund', 'write'],
    ]);
  });

  test('a resource nested under another is its own resource, not an action of its parent', () => {
    const nested = ids(
      at('GET', '/api/actions/'),
      at('GET', '/api/actions/{id}/'),
      at('GET', '/api/actions/{id}/comments/'),
      at('DELETE', '/api/actions/{id}/comments/{cid}/'),
    );
    expect(nested).toEqual(['resource.api.actions.list', 'resource.api.actions.read', 'resource.api.actions.comments.list', 'resource.api.actions.comments.delete']);
  });

  test('third-party handlers are never derived from', () => {
    expect(ids(at('GET', '/admin/users/', 'django.contrib.admin.options.ModelAdmin.changelist_view'), at('GET', '/admin/users/{id}/', 'django.contrib.admin.options.ModelAdmin.change_view'))).toEqual([]);
  });

  test('a trailing slash and the name of the parameter do not matter; OPTIONS is no verb', () => {
    expect(ids(at('GET', '/products'), at('OPTIONS', '/products'), at('GET', '/products/{id}'))).toEqual(['resource.products.list', 'resource.products.read']);
    expect(ids(at('GET', '/products/'), at('GET', '/products/{pk}'))).toEqual(['resource.products.list', 'resource.products.read']);
  });

  test('the vocabulary names a derived capability with extends and drops it with replaces', () => {
    const derived = derive(...invoices);
    const v = vocabulary({
      capabilities: [
        { extends: 'resource.api.invoices.list', name: 'See invoices' },
        {
          id: 'manage-invoices',
          name: 'Manage invoices',
          area: 'api.invoices',
          verb: 'write',
          endpoints: [['PUT', '/api/invoices/{pk}/']],
          check: 'IsAdminUser',
          evidence: [['app/views.py:1', 'IsAdminUser']],
          reason: 'One task.',
          replaces: ['resource.api.invoices.update'],
        },
      ],
    });
    const caps = capabilityList(runtime(), v, derived);
    expect(caps.map(c => [c.id, c.name, c.derived])).toEqual([
      ['resource.api.invoices.list', 'See invoices', 'resource'],
      ['resource.api.invoices.read', 'Read invoices', 'resource'],
      ['resource.api.invoices.create', 'Create invoices', 'resource'],
      ['resource.api.invoices.delete', 'Delete invoices', 'resource'],
      ['manage-invoices', 'Manage invoices', null],
    ]);
  });
});
