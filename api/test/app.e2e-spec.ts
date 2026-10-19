import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// CP13: this file used to assert the scaffold's dead `GET /` route and could
// never pass. It now pins the two contracts that actually exist: the global
// /api prefix (mirrored from main.ts) and the health check (which proves the
// boot-time DB connection works, since PrismaService.$connect runs on init).
describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / is not served (404) — routes live under /api', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('GET /api/health returns 200 with a connected database', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'bonagri-api',
      database: 'connected',
    });
  });
});
