import { Module } from '@nestjs/common';
import { CostingModule } from '../costing/costing.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [CostingModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
