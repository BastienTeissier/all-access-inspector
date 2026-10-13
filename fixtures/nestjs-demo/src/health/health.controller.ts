import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../auth/public.decorator.js';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
