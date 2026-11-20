import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Every refusal is an ApiError: an HTTP status, a stable `code` clients switch on,
 * and a sentence a person can read. Rendered as `{ code, error }`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest = (code: string, message: string) => new ApiError(400, code, message);
  static unauthorized = (message = 'Sign in again.', code = 'Unauthorized') => new ApiError(401, code, message);
  static forbidden = (code: string, message: string) => new ApiError(403, code, message);
  static notFound = (what: string) => new ApiError(404, 'NotFound', `${what} not found.`);
  static conflict = (code: string, message: string) => new ApiError(409, code, message);
  static notConfigured = (what: string) => new ApiError(503, 'NotConfigured', `${what} is not set up on this server.`);
  static upstream = (code: string, message: string) => new ApiError(502, code, message);
  static tooMany = () => new ApiError(429, 'TooManyRequests', 'Too many requests. Try again in a minute.');
}
