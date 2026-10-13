// Turn a path Nest or Express registered into the inventory path format: leading /, params as {name}.

export const normalize = (path: string): string => {
  let unwrapped = path;
  // Express 5 optional groups, {/:id} or {*path}, read as present; an inventory {name} has no / : or * inside.
  for (let previous = ''; previous !== unwrapped; ) {
    previous = unwrapped;
    unwrapped = unwrapped.replace(/\{([^{}]*[/:*][^{}]*)\}/g, '$1');
  }
  const converted = unwrapped
    .replace(/:(\w+)(?:\([^)]*\))?/g, '{$1}') // :id, and Express 4's :id(\d+)
    .replace(/\*(\w+)/g, '{$1}') // Express 5 named wildcard *path
    .replace(/\*/g, '{wildcard}') // a bare * (Express 4)
    .replace(/\/{2,}/g, '/');
  return converted.startsWith('/') ? converted : `/${converted}`;
};

export const join = (prefix: string, path: string): string => normalize(`${prefix}/${path}`.replace(/(.)\/+$/, '$1'));
