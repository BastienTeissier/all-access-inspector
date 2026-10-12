// Turn a path Nest or Express registered into the inventory path format: leading /, params as {name}.

export const normalize = (path: string): string => {
  const converted = path
    .replace(/:(\w+)(?:\([^)]*\))?/g, '{$1}') // :id, and Express 4's :id(\d+)
    .replace(/\*(\w+)/g, '{$1}') // Express 5 named wildcard *path
    .replace(/\*/g, '{wildcard}') // a bare * (Express 4)
    .replace(/\/{2,}/g, '/');
  return converted.startsWith('/') ? converted : `/${converted}`;
};

export const join = (prefix: string, path: string): string => normalize(`${prefix}/${path}`.replace(/(.)\/+$/, '$1'));
