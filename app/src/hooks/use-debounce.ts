import { useEffect, useState } from "react";

/**
 * 防抖 Hook：在 value 停止变化 delay 毫秒后才返回新值。
 *
 * 用途：把高频变化的输入（如搜索框每次按键）收敛为低频的稳定值，
 * 常用于喂给 React Query 的 queryKey，避免每次按键都发一次请求。
 * 输入本身仍保持受控/即时响应，只有「派生的防抖值」被延后。
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}
