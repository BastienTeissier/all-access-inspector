// The app answers this machine only. It listens on 127.0.0.1, and a page served under another host name that resolves
// there (DNS rebinding) is refused here, before it can read the inventory or post a Verdict.

import { type NextRequest, NextResponse } from 'next/server';

const LOCAL = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

export const proxy = (request: NextRequest): NextResponse =>
  LOCAL.test(request.headers.get('host') ?? '') ? NextResponse.next() : new NextResponse('the review app answers 127.0.0.1 only\n', { status: 403 });
