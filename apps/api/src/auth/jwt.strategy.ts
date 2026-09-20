import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AppConfig } from '../config/configuration';
import { APP_CONFIG } from '../common/tokens';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload, RequestUser } from '../common/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      // The browser client uses the HTTP-only cookie; API clients and tests may
      // use a bearer token. Both carry the same signed payload.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.[config.cookie.name] ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
    });
  }

  /**
   * Re-reads the user on every request. This costs one indexed primary-key
   * lookup and buys immediate revocation: deactivating a user or changing a
   * password invalidates outstanding tokens at once.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        warehouseId: true,
        costCenterId: true,
        isActive: true,
        tokenVersion: true,
      },
    });

    if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException();
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      warehouseId: user.warehouseId,
      costCenterId: user.costCenterId,
    };
  }
}
