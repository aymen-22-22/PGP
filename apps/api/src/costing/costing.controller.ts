import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { paginate } from '../common/dto/pagination.dto';
import type { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { CostingService } from './costing.service';
import { LandedCostStatementService } from './landed-cost-statement.service';
import { ExchangeRateService } from './exchange-rate.service';
import {
  CreateCostDocumentDto,
  CreateExchangeRateDto,
  PostCostDocumentDto,
  QueryCostDocumentsDto,
} from './dto/cost-document.dto';

@ApiTags('Costing')
@Controller()
export class CostingController {
  constructor(
    private readonly costing: CostingService,
    private readonly rates: ExchangeRateService,
    private readonly statements: LandedCostStatementService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('landed-cost/receipt/:receiptId')
  @ApiOperation({
    summary: 'Landed cost statement for one arrival',
    description:
      'Every cost that built up on the units in this goods-in, the route they took, and the unit cost arrived at.',
  })
  statementForReceipt(
    @CurrentUser() user: RequestUser,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
  ) {
    return this.statements.forReceipt(user, receiptId);
  }

  @Get('landed-cost/lot/:lotId')
  @ApiOperation({ summary: 'Landed cost statement for a whole purchase lot' })
  statementForLot(@CurrentUser() user: RequestUser, @Param('lotId', ParseUUIDPipe) lotId: string) {
    return this.statements.forLot(user, lotId);
  }

  @Get('lots')
  @ApiOperation({ summary: 'Purchase lots — the batches costs are attached to' })
  async lots(@Query() query: QueryCostDocumentsDto) {
    const where: Prisma.LotWhereInput = query.search
      ? { number: { contains: query.search, mode: 'insensitive' } }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.lot.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          purchase: { select: { id: true, number: true } },
          _count: { select: { devices: true, costDocuments: true } },
        },
      }),
      this.prisma.lot.count({ where }),
    ]);
    const data = rows.map(({ _count, ...l }) => ({
      ...l,
      unitPurchaseCost: l.unitPurchaseCost.toFixed(2),
      deviceCount: _count.devices,
    }));
    return paginate(data, total, query);
  }

  @Get('cost-documents')
  @ApiOperation({ summary: 'List handling, freight and customs bills' })
  async list(@Query() query: QueryCostDocumentsDto) {
    const where: Prisma.CostDocumentWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.lotId ? { lotId: query.lotId } : {}),
      ...(query.from || query.to
        ? {
            incurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.costDocument.findMany({
        where,
        orderBy: { incurredAt: 'desc' },
        skip: query.skip,
        take: query.pageSize,
        include: {
          lot: { select: { id: true, number: true } },
          postedBy: { select: { id: true, name: true } },
          _count: { select: { entries: true } },
        },
      }),
      this.prisma.costDocument.count({ where }),
    ]);

    const data = rows.map(({ _count, ...d }) => ({
      ...d,
      amount: d.amount.toFixed(2),
      amountBase: d.amountBase.toFixed(2),
      exchangeRate: d.exchangeRate.toFixed(8),
      unitCount: _count.entries,
    }));
    return paginate(data, total, query);
  }

  @Get('cost-documents/:id')
  @ApiOperation({ summary: 'One cost bill and how it was spread' })
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.costing.findOne(user, id);
  }

  @Get('cost-documents/:id/entries')
  @ApiOperation({ summary: 'How one bill was split, unit by unit' })
  async entries(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.prisma.costEntry.findMany({
      where: { costDocumentId: id },
      orderBy: { createdAt: 'asc' },
      take: 5000,
      select: {
        id: true,
        amount: true,
        basis: true,
        type: true,
        device: { select: { id: true, imei: true, landedCost: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      amount: r.amount.toFixed(4),
      basis: r.basis?.toFixed(4) ?? null,
      imei: r.device.imei,
      deviceId: r.device.id,
      landedCost: r.device.landedCost?.toFixed(2) ?? null,
    }));
  }

  @Post('cost-documents')
  @ApiOperation({
    summary: 'Record a cost and spread it over the units it applies to',
    description:
      'Bill it in the currency you were charged; DZD is converted to EUR at the rate in force on `incurredAt`, ' +
      'and that rate is stamped on the document. Posting also restates any completed sale whose units are affected.',
  })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCostDocumentDto) {
    return this.costing.create(user, dto);
  }

  @Post('cost-documents/:id/post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post a draft cost document' })
  post(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostCostDocumentDto,
  ) {
    return this.costing.post(user, id, dto.manualAmounts);
  }

  @Post('cost-documents/:id/reverse')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reverse a posted cost document, restating affected units and sales' })
  reverse(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.costing.reverse(user, id);
  }

  @Post('costing/rebuild')
  @AdminOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rebuild every landed cost from the ledger',
    description: 'Proves the stored figures reconcile to the cost entries. Safe to run at any time.',
  })
  rebuild(@CurrentUser() user: RequestUser) {
    return this.costing.rebuildAll(user);
  }

  @Get('exchange-rates')
  @ApiOperation({ summary: 'Dated conversion rates' })
  listRates() {
    return this.rates.list();
  }

  @Post('exchange-rates')
  @AdminOnly()
  @ApiOperation({
    summary: 'Add a rate from a date',
    description: 'Never edits an existing rate — costs already converted keep the rate they were converted at.',
  })
  addRate(@Body() dto: CreateExchangeRateDto) {
    return this.rates.add(dto);
  }
}
