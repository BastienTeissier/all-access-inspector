import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { Public } from '../auth/public.decorator.js';

// API clients authenticate with a bearer token rather than the session cookie.
@Public()
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'account', version: '1' })
export class AccountController {
  @Get('me')
  me() {
    return {};
  }

  @Patch('me')
  update(@Body() body: object) {
    return body;
  }
}
