export const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`environment variable ${name} is required`);
  return value;
};
