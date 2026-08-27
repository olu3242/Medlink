export function resolveServerOrigin(
  names: readonly string[],
  localOrigin: string,
  capability: string,
): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value.replace(/\/$/, "");
  }
  if (process.env.VERCEL === "1") {
    throw new Error(`${names.join(" or ")} is required for hosted ${capability}`);
  }
  return localOrigin;
}
