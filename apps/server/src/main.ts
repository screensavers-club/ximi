import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { raw } from 'express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { config } from 'dotenv';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './util/http-exception.filter';

config();

const logger = new Logger('Process');

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason}`);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {});
  app.use(raw({ type: 'application/webhook+json' }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('XIMI')
    .setDescription('The XIMI API specification')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.port || 4000;
  await app.listen(port);
  logger.log(`Listening on ${port}`);
}

bootstrap();
