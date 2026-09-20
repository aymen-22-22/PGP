import { Global, Module } from '@nestjs/common';
import { loadConfiguration } from '../config/configuration';
import { APP_CONFIG } from './tokens';
import { DocumentNumberService } from './services/document-number.service';
import { ImageStorageService } from './services/image-storage.service';
import { MovementService } from './services/movement.service';
import { WarehouseAccessService } from './services/warehouse-access.service';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfiguration },
    WarehouseAccessService,
    DocumentNumberService,
    MovementService,
    ImageStorageService,
  ],
  exports: [
    APP_CONFIG,
    WarehouseAccessService,
    DocumentNumberService,
    MovementService,
    ImageStorageService,
  ],
})
export class CommonModule {}
