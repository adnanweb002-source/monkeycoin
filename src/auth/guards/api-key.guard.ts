import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const apiKey = req.headers['x-api-key'];

    if (apiKey !== process.env.ADMIN_BOOTSTRAP_KEY)
      throw new UnauthorizedException('Invalid API key');

    return true;
  }
}
