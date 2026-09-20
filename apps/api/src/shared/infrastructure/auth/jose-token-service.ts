import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../../../config/env.js';
import { parseDuration } from './duration.js';
import { UnauthenticatedError } from '../../domain/errors.js';
import type {
  AccessTokenClaims,
  IssuedToken,
  RefreshTokenClaims,
  TokenService,
} from '../../application/ports.js';

const ISSUER = 'myaihub';
const ACCESS_AUDIENCE = 'myaihub:access';
const REFRESH_AUDIENCE = 'myaihub:refresh';

function toBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function requireString(payload: JWTPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new UnauthenticatedError('TOKEN_INVALID', 'Token malformado.');
  }
  return value;
}

export class JoseTokenService implements TokenService {
  private readonly accessSecret = toBytes(env.JWT_ACCESS_SECRET);
  private readonly refreshSecret = toBytes(env.JWT_REFRESH_SECRET);
  private readonly accessTtl = parseDuration(env.ACCESS_TOKEN_TTL);
  private readonly refreshTtl = parseDuration(env.REFRESH_TOKEN_TTL);

  private async sign(
    payload: JWTPayload,
    secret: Uint8Array,
    audience: string,
    ttlSeconds: number,
  ): Promise<IssuedToken> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + ttlSeconds;

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(secret);

    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  private async verify(token: string, secret: Uint8Array, audience: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience });
      return payload;
    } catch (error) {
      const code =
        error instanceof Error && error.name === 'JWTExpired' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
      throw new UnauthenticatedError(
        code,
        code === 'TOKEN_EXPIRED' ? 'Sessão expirada.' : 'Token inválido.',
      );
    }
  }

  async issueAccessToken(claims: AccessTokenClaims): Promise<IssuedToken> {
    return this.sign(
      {
        sub: claims.userId,
        accountId: claims.accountId,
        role: claims.role,
        sessionId: claims.sessionId,
      },
      this.accessSecret,
      ACCESS_AUDIENCE,
      this.accessTtl,
    );
  }

  async issueRefreshToken(claims: RefreshTokenClaims): Promise<IssuedToken> {
    return this.sign(
      { sub: claims.userId, sessionId: claims.sessionId, tokenId: claims.tokenId },
      this.refreshSecret,
      REFRESH_AUDIENCE,
      this.refreshTtl,
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.verify(token, this.accessSecret, ACCESS_AUDIENCE);
    return {
      userId: requireString(payload, 'sub'),
      accountId: requireString(payload, 'accountId'),
      role: requireString(payload, 'role'),
      sessionId: requireString(payload, 'sessionId'),
    };
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const payload = await this.verify(token, this.refreshSecret, REFRESH_AUDIENCE);
    return {
      userId: requireString(payload, 'sub'),
      sessionId: requireString(payload, 'sessionId'),
      tokenId: requireString(payload, 'tokenId'),
    };
  }
}
