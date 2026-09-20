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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOnly } from '../common/decorators/roles.decorator';
import { BusinessError } from '../common/errors/business.error';
import type { RequestUser } from '../common/types';
import { BrandsService } from './brands.service';
import { CreateBrandDto, QueryBrandsDto, UpdateBrandDto } from './dto/brand.dto';

@ApiTags('Brands')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @ApiOperation({ summary: 'Every make, with how many products each has' })
  list(@Query() query: QueryBrandsDto) {
    return this.brands.list(query);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Create a make (admin only — the catalogue is global)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBrandDto) {
    return this.brands.create(user, dto);
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Rename or retire a make' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brands.update(user, id, dto);
  }

  @Post(':id/image')
  @AdminOnly()
  @UseInterceptors(
    FileInterceptor('image', { storage: memoryStorage(), limits: { files: 1, fileSize: 8_000_000 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { image: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Set the brand logo (admin only). JPEG, PNG or WebP.' })
  setImage(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BusinessError(ErrorCode.VALIDATION_FAILED, 'Choose a picture to upload.');
    }
    return this.brands.setImage(user, id, file.buffer);
  }

  @Delete(':id/image')
  @AdminOnly()
  @ApiOperation({ summary: 'Remove the brand logo (admin only)' })
  removeImage(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.brands.removeImage(user, id);
  }
}
