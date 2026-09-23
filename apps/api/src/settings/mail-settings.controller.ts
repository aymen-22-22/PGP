import { BadRequestException, Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import type { RequestUser } from '../common/types';
import { writeLog } from '../logging/file-log';
import { MailerService } from '../notifications/mailer.service';
import { SettingsService, type SmtpSettings } from './settings.service';

class SmtpDto {
  @IsString() @MinLength(3) @MaxLength(200) host!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(65535) port!: number;
  @IsBoolean() secure!: boolean;
  @IsString() @MaxLength(200) user!: string;
  /** Blank keeps the password already saved. */
  @IsOptional() @IsString() @MaxLength(500) password?: string;
  @IsString() @MinLength(3) @MaxLength(200) from!: string;
  @IsBoolean() enabled!: boolean;
}

class TestDto {
  @IsEmail() to!: string;
}

/** The mail server, set from the app instead of the server's environment. */
@ApiTags('Settings')
@Controller('settings/mail')
@AdminOnly()
export class MailSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly mailer: MailerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The mail server in use (the password is never returned)' })
  async read() {
    const server = await this.mailer.server();
    return {
      source: server.host ? server.source : 'none',
      host: server.host,
      port: server.port,
      secure: server.secure,
      user: server.user,
      hasPassword: Boolean(server.pass),
      from: server.from,
      enabled: server.enabled,
    };
  }

  @Put()
  @ApiOperation({ summary: 'Save the mail server; takes over from the environment' })
  async save(@Body() dto: SmtpDto, @CurrentUser() user: RequestUser) {
    const current = await this.settings.get<SmtpSettings>('smtp');
    const passEnc = dto.password
      ? this.settings.encrypt(dto.password)
      : (current?.passEnc ?? (await this.envPassword()));
    await this.settings.set<SmtpSettings>(
      'smtp',
      { host: dto.host.trim(), port: dto.port, secure: dto.secure, user: dto.user.trim(), passEnc, from: dto.from.trim(), enabled: dto.enabled },
      user.id,
    );
    this.mailer.reset();
    writeLog('info', 'Settings', `Mail server changed by ${user.email}: ${dto.host}:${dto.port}`);
    return this.read();
  }

  @Delete()
  @ApiOperation({ summary: 'Forget the saved server and go back to the environment settings' })
  async clear(@CurrentUser() user: RequestUser) {
    await this.settings.remove('smtp');
    this.mailer.reset();
    writeLog('info', 'Settings', `Saved mail server removed by ${user.email}`);
    return this.read();
  }

  @Post('test')
  @ApiOperation({ summary: 'Connect with the saved settings and send a test email' })
  async test(@Body() dto: TestDto) {
    const server = await this.mailer.server();
    if (!server.host) throw new BadRequestException('Save a mail server first.');
    try {
      await this.mailer.verify(server);
      await this.mailer.send({
        to: [dto.to],
        subject: '[Phone ERP] Test email — the mail server works',
        html: `<p style="font-family:sans-serif">This test was sent by Phone ERP through <b>${server.host}:${server.port}</b>. Notifications and alerts will arrive the same way.</p>`,
        text: `This test was sent by Phone ERP through ${server.host}:${server.port}.`,
      });
      return { ok: true };
    } catch (error) {
      throw new BadRequestException(`The mail server refused: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Keeps the environment's password when an admin first copies those settings into the app. */
  private async envPassword(): Promise<string | null> {
    const server = await this.mailer.server();
    return server.source === 'env' && server.pass ? this.settings.encrypt(server.pass) : null;
  }
}
