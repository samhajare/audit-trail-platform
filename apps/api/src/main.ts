import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { config } from './config/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.CORS_ORIGIN.split(','), credentials: true });
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  const log = new Logger('Bootstrap');
  log.log(`API on :${config.PORT}/api  (auth ${config.AUTH_DISABLED ? 'DISABLED (dev)' : 'Auth0'})`);
}
void bootstrap();
