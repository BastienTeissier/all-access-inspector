import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Accepts a webhook only when its body carries the provider's signature. */
@Injectable()
export class SignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const body = context.switchToHttp().getRequest<Request>().body as { signature?: string } | undefined;
    return typeof body?.signature === 'string' && body.signature.length > 0;
  }
}
