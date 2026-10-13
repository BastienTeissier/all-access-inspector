import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC } from './public.decorator.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const open = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (open) return true;
    if (!context.switchToHttp().getRequest<Request>().headers.cookie?.includes('session=')) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
