import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { HttpMetricsInterceptor } from './metrics/http-metrics.interceptor';
import { ALLOWED_BROWSER_ORIGINS } from './config/allowed-origins';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalInterceptors(new HttpMetricsInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(cookieParser());
  app.enableCors({
    origin: ALLOWED_BROWSER_ORIGINS,
    credentials: true,
    methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-CSRF-Token',
  });


  // Health check endpoint
  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).send('OK');
  });


  const config = new DocumentBuilder()
    .setTitle('Vaultire API')
    .setDescription('API documentation for Vaultire application')
    .setVersion('1.0')
    .addBearerAuth() // optional
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(3000);
}
bootstrap();