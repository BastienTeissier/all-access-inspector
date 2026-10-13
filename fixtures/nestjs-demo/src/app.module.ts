import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD, RouterModule } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AccountController } from './account/account.controller.js';
import { AdminModule } from './admin/admin.module.js';
import { JwtStrategy } from './auth/jwt.strategy.js';
import { SessionGuard } from './auth/session.guard.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { HealthController } from './health/health.controller.js';
import { PartnerKeyMiddleware } from './partner/partner-key.middleware.js';
import { PartnerController } from './partner/partner.controller.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';

@Module({
  imports: [
    PassportModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AdminModule,
    RouterModule.register([{ path: 'admin', module: AdminModule }]),
  ],
  controllers: [AccountController, CatalogController, HealthController, PartnerController, WebhooksController],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PartnerKeyMiddleware).forRoutes(PartnerController);
  }
}
