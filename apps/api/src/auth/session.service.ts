import { Inject, Injectable } from '@nestjs/common';
import { GlobalRole } from '@prisma/client';
import Redis from 'ioredis';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { env } from '../common/config/env';
import { REDIS } from '../redis/redis.module';

// In der Session steht alles, was Guards pro Request brauchen – erspart
// einen DB-Roundtrip pro Request. Rollenänderungen invalidieren die
// Sessions des Kontos (siehe AuthService), damit hier nie veraltete
// Rechte kleben bleiben.
export interface SessionData {
  accountId: string;
  personId: string;
  globalRole: GlobalRole;
  createdAt: string;
}

// Sessions in Redis statt JWT: sofortige Revocation (kompromittierte
// Konten, Passwort-Reset), kein Token-Material im Browser-Storage.
// Key: session:<sha256(token)> – auch Redis-Dumps verraten keine Cookies.
// Pro Konto ein Set der Session-Hashes für "alle Sessions beenden".
@Injectable()
export class SessionService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private sessionKey(tokenHash: string): string {
    return `session:${tokenHash}`;
  }

  private accountKey(accountId: string): string {
    return `account-sessions:${accountId}`;
  }

  async create(data: Omit<SessionData, 'createdAt'>): Promise<string> {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const ttlSeconds = env.SESSION_TTL_HOURS * 3600;
    const payload: SessionData = { ...data, createdAt: new Date().toISOString() };
    await this.redis
      .multi()
      .set(this.sessionKey(tokenHash), JSON.stringify(payload), 'EX', ttlSeconds)
      .sadd(this.accountKey(data.accountId), tokenHash)
      .expire(this.accountKey(data.accountId), ttlSeconds)
      .exec();
    return token;
  }

  async get(token: string): Promise<SessionData | null> {
    const raw = await this.redis.get(this.sessionKey(hashToken(token)));
    return raw ? (JSON.parse(raw) as SessionData) : null;
  }

  async destroy(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    const raw = await this.redis.get(this.sessionKey(tokenHash));
    if (raw) {
      const { accountId } = JSON.parse(raw) as SessionData;
      await this.redis.srem(this.accountKey(accountId), tokenHash);
    }
    await this.redis.del(this.sessionKey(tokenHash));
  }

  // Passwort-Reset, Rollenwechsel, Admin-Intervention: alle Geräte abmelden
  async destroyAllForAccount(accountId: string): Promise<void> {
    const hashes = await this.redis.smembers(this.accountKey(accountId));
    if (hashes.length > 0) {
      await this.redis.del(...hashes.map((h) => this.sessionKey(h)));
    }
    await this.redis.del(this.accountKey(accountId));
  }
}
