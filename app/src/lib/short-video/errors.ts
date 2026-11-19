export class SvError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}
export function invariant(
  value: unknown,
  status = 409,
  code = "CONFLICT",
  message = "状态或版本已变化，请重新读取"
): asserts value {
  if (!value) throw new SvError(status, code, message);
}
