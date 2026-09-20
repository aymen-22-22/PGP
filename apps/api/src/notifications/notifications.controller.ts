import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationStatus } from '@prisma/client';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { paginate, PaginationQueryDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @AdminOnly()
  @ApiOperation({
    summary: 'What the system has emailed, and what it could not',
    description: 'Mail is invisible by default; this is where a failure to send can actually be seen.',
  })
  async list(@Query() query: PaginationQueryDto) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        select: {
          id: true,
          event: true,
          subject: true,
          recipients: true,
          status: true,
          attempts: true,
          lastError: true,
          sentAt: true,
          createdAt: true,
          referenceType: true,
          referenceId: true,
        },
      }),
      this.prisma.notification.count(),
    ]);

    const pending = await this.prisma.notification.count({
      where: { status: NotificationStatus.PENDING },
    });
    const failed = await this.prisma.notification.count({
      where: { status: NotificationStatus.FAILED },
    });

    return { ...paginate(data, total, query), summary: { pending, failed } };
  }

  @Post('flush')
  @AdminOnly()
  @ApiOperation({ summary: 'Try the queue now rather than waiting for the next sweep' })
  flush() {
    return this.notifications.flush();
  }
}
