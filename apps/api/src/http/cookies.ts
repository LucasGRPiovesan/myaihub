import type { CookieOptions, Response } from 'express';
import { env } from '../config/env.js';

export const ACCESS_COOKIE = 'mah_at';
export const REFRESH_COOKIE = 'mah_rt';

/**
 * O refresh token só é enviado para as rotas que o usam. Reduzir o alcance do
 * cookie reduz a superfície de vazamento (XSS não lê httpOnly, mas CSRF e logs
 * de proxy alcançam qualquer coisa que o browser envie por padrão).
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

function baseOptions(expiresAt: Date, path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path,
    expires: expiresAt,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(
  response: Response,
  tokens: {
    accessToken: string;
    accessTokenExpiresAt: Date;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  },
): void {
  response.cookie(ACCESS_COOKIE, tokens.accessToken, baseOptions(tokens.accessTokenExpiresAt, '/'));
  response.cookie(
    REFRESH_COOKIE,
    tokens.refreshToken,
    baseOptions(tokens.refreshTokenExpiresAt, REFRESH_COOKIE_PATH),
  );
}

export function clearAuthCookies(response: Response): void {
  const common = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  } satisfies CookieOptions;

  response.clearCookie(ACCESS_COOKIE, { ...common, path: '/' });
  response.clearCookie(REFRESH_COOKIE, { ...common, path: REFRESH_COOKIE_PATH });
}
