// Endpoint Inventory model, canonical serialisation and the checks JSON Schema cannot express.

export const SCHEMA_VERSION = '1';
export const METHODS = ['ANY', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'] as const;
export const AUTHENTICATION = ['anonymous', 'optional', 'required', 'unknown'] as const;
export const AUTHORIZATION = ['none', 'rule', 'unknown'] as const;
export const LAYERS = ['global', 'class', 'method', 'framework-default', null] as const;

export type Layer = (typeof LAYERS)[number];

export class ValidationError extends Error {}

export interface Axis {
  value: string;
  layer: Layer;
  raw: string | null;
  rule: string | null;
}

export interface Endpoint {
  method: string;
  path: string;
  handler: string;
  authentication: Axis;
  authorization: Axis;
  dimensions: Record<string, string>;
  unknown_reason: string | null;
}

export interface Env {
  name: string;
  value: string;
  reason: string;
}

export interface Stub {
  target: string;
  reason: string;
}

export interface Pin {
  setting: string;
  value: unknown;
  reason: string;
}

export interface BootEnvironment {
  entry: string;
  environ: Env[];
  stubs: Stub[];
  pinned: Pin[];
}

export interface Inventory {
  schema_version: string;
  stack: string;
  discovery_mode: string;
  coverage: string;
  coverage_note: string | null;
  base_script: { stack: string; version: string };
  boot_environment: BootEnvironment;
  project_dimensions: Record<string, string[]>;
  endpoints: Endpoint[];
}

export const isUnknown = (e: Endpoint): boolean =>
  e.authentication.value === 'unknown' || e.authorization.value === 'unknown';

export const label = (e: Endpoint): string => `${e.method} ${e.path} (${e.handler})`;

/** Code point order, as Python sorts strings; `<` on JS strings compares UTF-16 code units. */
export const compareText = (a: string, b: string): number => {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
};

const sortKey = (e: Endpoint): string[] => [e.path, e.method, e.handler];

export const compareEndpoints = (a: Endpoint, b: Endpoint): number => {
  const [x, y] = [sortKey(a), sortKey(b)];
  for (let i = 0; i < x.length; i++) {
    const d = compareText(x[i]!, y[i]!);
    if (d !== 0) return d;
  }
  return 0;
};

const identity = (e: Endpoint): string => JSON.stringify(sortKey(e));

const axis = (a: Axis): Axis => ({ value: a.value, layer: a.layer, raw: a.raw, rule: a.rule });

const endpoint = (e: Endpoint, dimensions: string[]): Endpoint => ({
  method: e.method,
  path: e.path,
  handler: e.handler,
  authentication: axis(e.authentication),
  authorization: axis(e.authorization),
  dimensions: Object.fromEntries(
    [...dimensions.filter(d => d in e.dimensions), ...Object.keys(e.dimensions).filter(d => !dimensions.includes(d))].map(
      d => [d, e.dimensions[d]!],
    ),
  ),
  unknown_reason: e.unknown_reason,
});

/** Rebuild every object with its keys in schema order, whatever order the source had. */
export const canonical = (inventory: Inventory): Inventory => {
  const boot = inventory.boot_environment;
  const dimensions = Object.keys(inventory.project_dimensions);
  return {
    schema_version: inventory.schema_version,
    stack: inventory.stack,
    discovery_mode: inventory.discovery_mode,
    coverage: inventory.coverage,
    coverage_note: inventory.coverage_note,
    base_script: { stack: inventory.base_script.stack, version: inventory.base_script.version },
    boot_environment: {
      entry: boot.entry,
      environ: boot.environ.map(e => ({ name: e.name, value: e.value, reason: e.reason })),
      stubs: boot.stubs.map(s => ({ target: s.target, reason: s.reason })),
      pinned: boot.pinned.map(p => ({ setting: p.setting, value: p.value, reason: p.reason })),
    },
    project_dimensions: inventory.project_dimensions,
    endpoints: inventory.endpoints.map(e => endpoint(e, dimensions)),
  };
};

/** Serialise per plan §2; the reference bytes are schema/samples/canonical.json. */
export const toCanonicalJson = (inventory: Inventory): string => {
  const { endpoints, ...header } = canonical(inventory);
  const lines = ['{', ...Object.entries(header).map(([key, value]) => `  ${compact(key)}: ${compact(value)},`)];
  if (endpoints.length > 0) {
    lines.push('  "endpoints": [');
    lines.push([...endpoints].sort(compareEndpoints).map(e => `    ${compact(e)}`).join(',\n'));
    lines.push('  ]');
  } else {
    lines.push('  "endpoints": []');
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
};

/** Read a Committed Inventory; throws on a missing key, so a malformed file fails before the boot. */
export const fromJson = (text: string): Inventory => {
  const data = JSON.parse(text) as Inventory;
  const inventory = canonical(data);
  const missing = (value: unknown): boolean => value === undefined;
  const fields = [
    ...Object.values(inventory),
    ...Object.values(inventory.base_script),
    ...Object.values(inventory.boot_environment),
    ...inventory.endpoints.flatMap(e => [...Object.values(e), ...Object.values(e.authentication), ...Object.values(e.authorization)]),
  ];
  if (fields.some(missing)) throw new TypeError('missing key');
  return inventory;
};

/**
 * Diff lines from the Committed Inventory to the regenerated one; empty when they match.
 * Structural, so the committed file's ordering and whitespace never count as a difference.
 */
export const check = (committedInventory: Inventory, currentInventory: Inventory): string[] => {
  const committed = canonical(committedInventory);
  const current = fromJson(toCanonicalJson(currentInventory)); // compare as written
  const old = committed as unknown as Record<string, unknown>;
  const now = current as unknown as Record<string, unknown>;
  const lines = Object.keys(now)
    .filter(key => key !== 'endpoints' && compact(old[key]) !== compact(now[key]))
    .map(key => `~ ${key}: ${compact(old[key])} -> ${compact(now[key])}`);
  const before = new Map<string, Endpoint>();
  for (const e of committed.endpoints) {
    if (before.has(identity(e))) lines.push(`- ${label(e)} (duplicate entry)`);
    before.set(identity(e), e);
  }
  const after = new Map(current.endpoints.map(e => [identity(e), e]));
  const keys = [...new Map([...before, ...after]).values()].sort(compareEndpoints).map(identity);
  for (const key of keys) {
    const was = before.get(key);
    const is = after.get(key);
    if (is === undefined) {
      lines.push(`- ${label(was!)}`);
    } else if (was === undefined) {
      const unknown = isUnknown(is) ? ' [unknown]' : '';
      lines.push(
        `+ ${label(is)} authentication=${is.authentication.value} authorization=${is.authorization.value}${unknown}`,
      );
    } else {
      const [x, y] = [flatten(was), flatten(is)];
      for (const name of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (compact(x[name] ?? null) !== compact(y[name] ?? null)) {
          lines.push(`~ ${label(is)} ${name}: ${text(x[name])} -> ${text(y[name])}`);
        }
      }
    }
  }
  return lines;
};

const flatten = (data: object, prefix = ''): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(data).flatMap(([key, value]) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(flatten(value as object, `${prefix}${key}.`))
        : [[prefix + key, value]],
    ),
  );

const text = (value: unknown): string => (typeof value === 'string' ? value : compact(value ?? null));

/** Throw ValidationError naming the first offending endpoint; never write an invalid inventory. */
export const validate = (inventory: Inventory): void => {
  if (inventory.discovery_mode === 'static' && inventory.coverage !== 'best-effort') {
    throw new ValidationError('static discovery must claim coverage best-effort');
  }
  if (inventory.coverage === 'best-effort' && !inventory.coverage_note) {
    throw new ValidationError('coverage best-effort requires a coverage_note');
  }
  for (const [name, values] of Object.entries(inventory.project_dimensions)) {
    if (values.length === 0 || new Set(values).size !== values.length || values.includes('')) {
      throw new ValidationError(`dimension ${name} needs a non-empty list of distinct non-empty values`);
    }
  }
  const seen = new Set<string>();
  for (const e of inventory.endpoints) {
    validateEndpoint(e, inventory.project_dimensions);
    if (seen.has(identity(e))) throw new ValidationError(`duplicate endpoint ${label(e)}`);
    seen.add(identity(e));
  }
};

const validateEndpoint = (e: Endpoint, projectDimensions: Record<string, string[]>): void => {
  const fail = (message: string): never => {
    throw new ValidationError(`${label(e)}: ${message}`);
  };
  if (!(METHODS as readonly string[]).includes(e.method)) fail(`method ${JSON.stringify(e.method)} outside ${METHODS.join(', ')}`);
  if (!e.path.startsWith('/')) fail('path must start with /');
  for (const [name, a, values] of [
    ['authentication', e.authentication, AUTHENTICATION],
    ['authorization', e.authorization, AUTHORIZATION],
  ] as const) {
    if (!(values as readonly string[]).includes(a.value)) {
      fail(`${name}.value ${JSON.stringify(a.value)} outside the Core Classification`);
    }
    if (!LAYERS.includes(a.layer)) fail(`${name}.layer ${JSON.stringify(a.layer)} outside the layers`);
    if ((a.value === 'unknown') !== (a.rule === null)) {
      fail(`${name}: an unknown value has no rule and any other value names one`);
    }
  }
  if (e.unknown_reason !== null && (!e.unknown_reason || !isUnknown(e))) {
    fail('unknown_reason must be non-empty and sit next to an unknown value');
  }
  const declared = Object.keys(projectDimensions).sort();
  if (JSON.stringify(Object.keys(e.dimensions).sort()) !== JSON.stringify(declared)) {
    fail(`dimensions [${Object.keys(e.dimensions).sort()}] must equal project dimensions [${declared}]`);
  }
  for (const [dimension, value] of Object.entries(e.dimensions)) {
    if (!projectDimensions[dimension]!.includes(value)) fail(`dimension ${dimension}=${JSON.stringify(value)} is not declared`);
  }
};

/** JSON with ", " and ": " separators; non-ASCII and / unescaped, as Python's json.dumps(ensure_ascii=False). */
export const compact = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(compact).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${compact(v)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value);
};
