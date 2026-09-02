import type { AppError, Result } from './domain';

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (
  code: string,
  message: string,
  options: Pick<AppError, 'retryable' | 'details'> = {},
): Result<never> => ({
  ok: false,
  error: {
    code,
    message,
    ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
    ...(options.details === undefined ? {} : { details: options.details }),
  },
});

export const toAppError = (error: unknown, code = 'UNEXPECTED_ERROR'): AppError => ({
  code,
  message: error instanceof Error ? error.message : String(error),
});