import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ROLES } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES, [context.getHandler(), context.getClass()]);
    if (!roles) return true;
    const role = context.switchToHttp().getRequest<Request & { user?: { role: string } }>().user?.role;
    if (!role || !roles.includes(role)) throw new ForbiddenException();
    return true;
  }
}
