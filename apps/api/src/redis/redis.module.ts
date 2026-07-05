import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../common/config/env';

// Injection-Token für den ioredis-Client. Ein einziger geteilter Client
// für Sessions & Co.; BullMQ bekommt später eigene Verbindungen, weil es
// blockierende Kommandos nutzt und Verbindungen nicht teilen darf.
export const REDIS = Symbol('REDIS');

// Eigenes Provider-Objekt nur für den sauberen Shutdown (Tests/SIGTERM
// hängen sonst an offenen Redis-Verbindungen).
export class RedisShutdown implements OnApplicationShutdown {
  constructor(private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }),
    },
    {
      provide: RedisShutdown,
      useFactory: (redis: Redis) => new RedisShutdown(redis),
      inject: [REDIS],
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
