import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { APP_CONFIG } from '../common/tokens';
import type { RequestUser } from '../common/types';
import { UpdatePreferencesDto } from '../users/dto/user.dto';
import { AppConfig } from '../config/configuration';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Only the stricter 'login' bucket applies here (THROTTLE_LOGIN_LIMIT).
  @SkipThrottle({ default: true })
  @ApiOperation({ summary: 'Sign in and receive an HTTP-only session cookie' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password, context(req));
    this.setAuthCookies(res, result.accessToken, result.csrfToken);
    // The token is also returned for non-browser API clients.
    return { user: result.user, accessToken: result.accessToken, csrfToken: result.csrfToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out and clear the session cookie' })
  async logout(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user, context(req));
    res.clearCookie(this.config.cookie.name, this.cookieOptions());
    res.clearCookie(this.config.cookie.csrfName, { ...this.cookieOptions(), httpOnly: false });
    return { success: true };
  }

  @Get('me')
  @ApiOkResponse({ description: 'The signed-in user with their warehouse and cost centre' })
  @ApiOperation({ summary: 'Current user' })
  me(@CurrentUser() user: RequestUser) {
    return this.auth.me(user.id);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ default: true })
  @ApiOperation({ summary: 'Change your own password (signs out other sessions)' })
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, context(req));
    res.clearCookie(this.config.cookie.name, this.cookieOptions());
    return { success: true };
  }
  @Patch('preferences')
  @ApiOperation({
    summary: 'Change your own settings',
    description: 'Separate from PATCH /users/:id, which is an administrator changing someone else.',
  })
  async updatePreferences(@CurrentUser() user: RequestUser, @Body() dto: UpdatePreferencesDto) {
    return this.auth.updatePreferences(user, dto);
  }


  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.cookie.secure,
      sameSite: this.config.cookie.sameSite,
      domain: this.config.cookie.domain,
      path: '/',
    } as const;
  }

  private setAuthCookies(res: Response, token: string, csrf: string): void {
    const maxAge = parseExpiry(this.config.jwt.expiresIn);
    res.cookie(this.config.cookie.name, token, { ...this.cookieOptions(), maxAge });
    // Readable by JavaScript on purpose: the client echoes it back in the
    // X-CSRF-Token header, which a cross-site attacker cannot do.
    res.cookie(this.config.cookie.csrfName, csrf, { ...this.cookieOptions(), httpOnly: false, maxAge });
  }
}

function context(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}

/** Converts "12h" / "45m" / "3600" into milliseconds. */
function parseExpiry(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return 12 * 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1000;
  return amount * factor;
}
