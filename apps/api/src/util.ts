export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function str(body: Record<string, unknown>, key: string, required = true): string | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `Chýba pole "${key}"`);
    return undefined;
  }
  if (typeof v !== 'string') throw new HttpError(400, `Pole "${key}" musí byť text`);
  return v.trim();
}

export function num(body: Record<string, unknown>, key: string, required = true): number | undefined {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `Chýba pole "${key}"`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `Pole "${key}" musí byť číslo`);
  return n;
}
