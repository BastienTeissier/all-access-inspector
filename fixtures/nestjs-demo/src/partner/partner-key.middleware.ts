import { Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class PartnerKeyMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction) {
    if (!request.headers['x-partner-key']) throw new UnauthorizedException();
    next();
  }
}
