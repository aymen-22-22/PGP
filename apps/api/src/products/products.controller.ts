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
import { CreateProductDto, QueryProductsDto, UpdateProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List products (all authenticated users)' })
  list(@Query() query: QueryProductsDto) {
    return this.products.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one product' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(id);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Create a product (admin only — the catalogue is global)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateProductDto) {
    return this.products.create(user, dto);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Update a product (admin only)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user, id, dto);
  }

  @Post(':id/image')
  @AdminOnly()
  @UseInterceptors(
    FileInterceptor('image', {
      // Held in memory rather than written straight to disk: nothing reaches
      // the filesystem until the bytes have been checked to be a picture.
      storage: memoryStorage(),
      limits: { files: 1, fileSize: 8_000_000 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Set the product photo (admin only). JPEG, PNG or WebP.' })
  setImage(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Choose a picture to upload.');
    }
    return this.products.setImage(user, id, file.buffer);
  }

  @Delete(':id/image')
  @AdminOnly()
  @ApiOperation({ summary: 'Remove the product photo (admin only)' })
  removeImage(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.removeImage(user, id);
  }
}
