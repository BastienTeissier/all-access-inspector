import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';

@UseGuards(RolesGuard)
@Controller('users')
export class AdminController {
  @Roles('admin')
  @Get()
  list() {
    return [];
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return { id };
  }

  @Get('stats')
  stats() {
    return {};
  }
}
