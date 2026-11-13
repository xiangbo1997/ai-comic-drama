type Params = Record<string, unknown>;

function canonical(value: unknown): string | undefined {
  if (Array.isArray(value))
    return JSON.stringify(value.map((item) => canonical(item)));
  if (value && typeof value === "object") {
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Params)[key])])
    );
  }
  return JSON.stringify(value);
}

/** 按字段比较客户端基准，保护其他窗口新保存的设置；同字段冲突交给用户确认。 */
export function mergeProjectParams(
  current: Params,
  base: Params,
  proposed: Params
): { value: Params; conflicts: [] } | { conflicts: string[]; value?: never } {
  const value = { ...current };
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(proposed)])) {
    if (canonical(base[key]) === canonical(proposed[key])) continue;
    if (
      canonical(current[key]) !== canonical(base[key]) &&
      canonical(current[key]) !== canonical(proposed[key])
    ) {
      conflicts.push(key);
      continue;
    }
    if (Object.hasOwn(proposed, key)) value[key] = proposed[key];
    else delete value[key];
  }
  return conflicts.length ? { conflicts } : { value, conflicts: [] };
}
