import { AppController } from './app.controller';

it('pings', () => {
  expect(new AppController().ping()).toBe('pong');
});
