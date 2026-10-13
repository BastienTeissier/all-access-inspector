import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { ApiKeyGuard } from './api-key.guard';

@Controller()
export class AppController {
  @Get('ping')
  ping() {
    return 'pong';
  }

  @UseGuards(ApiKeyGuard)
  @Post('orders')
  create(@Body() body: object) {
    return body;
  }
}
