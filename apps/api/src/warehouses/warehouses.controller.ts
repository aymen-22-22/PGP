import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { ErrorCode } from '@phone-erp/shared-types';
import { BusinessError } from '../common/errors/business.error';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import type { RequestUser } from '../common/types';
import {
  CreateCostCenterDto,
  CreateWarehouseDto,
  QueryWarehousesDto,
  UpdateCostCenterDto,
  UpdateWarehouseDto,
} from './dto/warehouse.dto';
import { WarehousesService } from './warehouses.service';

@ApiTags('Warehouses')
@Controller()
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get('warehouses')
  @ApiOperation({ summary: 'List warehouses' })
  list(@CurrentUser() user: RequestUser, @Query() query: QueryWarehousesDto) {
    return this.warehouses.list(user, query);
  }

  @Get('warehouses/:id')
  @ApiOperation({ summary: 'Warehouse detail; stock counts only for users with access' })
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehouses.findOne(user, id);
  }

  @Post('warehouses')
  @AdminOnly()
  @ApiOperation({ summary: 'Create a warehouse' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateWarehouseDto) {
    return this.warehouses.create(user, dto);
  }

  @Patch('warehouses/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Update a warehouse' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.warehouses.update(user, id, dto);
  }

  @Get('countries')
  @ApiOperation({ summary: 'Countries the business operates in, with their currency' })
  listCountries() {
    return this.warehouses.listCountries();
  }

  @Get('cost-centers')
  @ApiOperation({ summary: 'List cost centres' })
  listCostCenters(@Query('warehouseId') warehouseId?: string) {
    return this.warehouses.listCostCenters(warehouseId);
  }

  @Post('cost-centers')
  @AdminOnly()
  @ApiOperation({ summary: 'Create a cost centre' })
  createCostCenter(@Body() dto: CreateCostCenterDto) {
    return this.warehouses.createCostCenter(dto);
  }

  @Patch('cost-centers/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Update a cost centre' })
  updateCostCenter(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCostCenterDto) {
    return this.warehouses.updateCostCenter(id, dto);
  }

  @Post('warehouses/:id/image')
  @AdminOnly()
  @UseInterceptors(
    FileInterceptor('image', { storage: memoryStorage(), limits: { files: 1, fileSize: 8_000_000 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Set the warehouse photo (admin only). JPEG, PNG or WebP.' })
  setImage(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Choose a picture to upload.');
    }
    return this.warehouses.setImage(user, id, file.buffer);
  }

  @Delete('warehouses/:id/image')
  @AdminOnly()
  @ApiOperation({ summary: 'Remove the warehouse photo (admin only)' })
  removeImage(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehouses.removeImage(user, id);
  }
}
