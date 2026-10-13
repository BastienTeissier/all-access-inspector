import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/public.decorator.js';

// Partners carry an API key, checked by PartnerKeyMiddleware, not a session.
@Public()
@Controller('partner')
export class PartnerController {
  @Get('orders')
  orders() {
    return [];
  }
}
