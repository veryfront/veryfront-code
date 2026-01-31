export function arrayToObject(arr: string[]): Record<string, string> {
  const obj: Record<string, string> = {};

  for (let i = 0; i < arr.length; i += 2) {
    const key = arr[i];
    const value = arr[i + 1];

    if (!key || value === undefined) continue;

    obj[key] = value;
  }

  return obj;
}
