export type RconErrorCode =
  | 'CONNECTION_FAILED'
  | 'AUTHENTICATION_FAILED'
  | 'CONNECT_TIMEOUT'
  | 'READ_TIMEOUT'
  | 'NOT_CONNECTED'
  | 'PARSE_ERROR'
  | 'POOL_EXHAUSTED'
  | 'DISCONNECTED';

export class RconError extends Error {
  public readonly code: RconErrorCode;

  constructor(code: RconErrorCode, message: string) {
    super(message);
    this.name = 'RconError';
    this.code = code;
  }
}

export type RconResult<T> = { ok: true; value: T } | { ok: false; error: RconError };

export function rconOk<T>(value: T): RconResult<T> {
  return { ok: true, value };
}

export function rconErr(code: RconErrorCode, message: string): RconResult<never> {
  return { ok: false, error: new RconError(code, message) };
}