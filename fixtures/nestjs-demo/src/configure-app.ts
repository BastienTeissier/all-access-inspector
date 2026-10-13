import { type INestApplication, VersioningType } from '@nestjs/common';
import express from 'express';

/** The HTTP setup main.ts applies before listening. */
export const configureApp = (app: INestApplication) => {
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableVersioning({ type: VersioningType.URI });
  const legacy = express.Router();
  legacy.get('/status', function legacyStatus(_request, response) {
    response.json({ status: 'ok' });
  });
  app.use(['/legacy', '/old'], legacy);
  const robots = express.Router();
  robots.get('/robots.txt', function robotsTxt(_request, response) {
    response.type('text/plain').send('User-agent: *\n');
  });
  app.use(robots);
};
