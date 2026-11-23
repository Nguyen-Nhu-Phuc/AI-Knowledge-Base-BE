import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { HealthModule } from './health/health.module';
import { StorageModule } from './storage/storage.module';
import { KnowledgeBasesModule } from './knowledge-bases/knowledge-bases.module';
import { DocumentsModule } from './documents/documents.module';
import { QueueModule } from './queue/queue.module';
import { SearchModule } from './search/search.module';
import { ChatModule } from './chat/chat.module';
import { UsageModule } from './usage/usage.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AclModule } from './acl/acl.module';
import { ConnectorsModule } from './connectors/connectors.module';
import { BotsModule } from './bots/bots.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { EntitiesModule } from './entities/entities.module';
import { McpModule } from './mcp/mcp.module';
import { EvalModule } from './eval/eval.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get('THROTTLE_TTL_MS', 60000)),
          limit: Number(config.get('THROTTLE_LIMIT', 100)),
        },
      ],
    }),
    PrismaModule,
    AuditModule,
    NotificationsModule,
    StorageModule,
    QueueModule,
    UsageModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    KnowledgeBasesModule,
    DocumentsModule,
    AclModule,
    SearchModule,
    ChatModule,
    ConnectorsModule,
    BotsModule,
    IntegrationsModule,
    EntitiesModule,
    McpModule,
    EvalModule,
    AnalyticsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
