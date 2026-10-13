import { All, Controller, UseGuards } from '@nestjs/common';

import { Public } from '../auth/public.decorator.js';
import { SignatureGuard } from '../auth/signature.guard.js';

@Public()
@Controller('webhooks')
export class WebhooksController {
  @UseGuards(SignatureGuard)
  @All('payments')
  payments() {
    return { received: true };
  }
}
