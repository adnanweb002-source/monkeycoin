import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import cookieParser from 'cookie-parser';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('NOWPayments IPN (e2e)', () => {
  let app: INestApplication<App>;
  const prevSecret = process.env.NOWPAYMENTS_IPN_SECRET;

  beforeAll(async () => {
    delete process.env.NOWPAYMENTS_IPN_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (prevSecret !== undefined) {
      process.env.NOWPAYMENTS_IPN_SECRET = prevSecret;
    } else {
      delete process.env.NOWPAYMENTS_IPN_SECRET;
    }
  });

  it('POST /wallet/payments/ipn returns 401 when NOWPAYMENTS_IPN_SECRET is unset', () => {
    return request(app.getHttpServer())
      .post('/wallet/payments/ipn')
      .set('Content-Type', 'application/json')
      .set('x-nowpayments-sig', 'deadbeef')
      .send({
        payment_id: '1',
        payment_status: 'finished',
        actually_paid: '1',
        pay_currency: 'USDT',
      })
      .expect(401);
  });
});
