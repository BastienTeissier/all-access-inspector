import { Controller, Get, Param } from '@nestjs/common';

import { Public } from '../auth/public.decorator.js';

@Public()
@Controller('products')
export class CatalogController {
  @Get()
  list() {
    return [];
  }

  @Get(':id')
  show(@Param('id') id: string) {
    return { id };
  }
}
