import { Module } from '@nestjs/common';
import { ImeisController } from './imeis.controller';
import { ImeisService } from './imeis.service';

@Module({
  controllers: [ImeisController],
  providers: [ImeisService],
  exports: [ImeisService],
})
export class ImeisModule {}
