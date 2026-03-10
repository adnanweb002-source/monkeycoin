import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { HttpMetricsInterceptor } from './metrics/http-metrics.interceptor';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);
   app.useGlobalInterceptors(new HttpMetricsInterceptor());
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(cookieParser());
  app.enableCors({
  origin: [
    'https://gogex.xyz',
    'https://admin.gogex.xyz',
    'http://localhost:5173',
    'http://localhost:8080', 
    'http://localhost:3000',
  ],
  credentials: true,
  methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type, Authorization',
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