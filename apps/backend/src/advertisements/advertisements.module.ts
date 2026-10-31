import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import {
  AdminAdvertisementsController,
  AdvertisementsController,
} from './advertisements.controller';
import { AdvertisementsService } from './advertisements.service';

/**
 * Own module rather than AdminModule (same reasoning as FeedbackModule and
 * AttributesModule): the storefront reads the banners anonymously, and a
 * controller inside AdminModule would inherit its class-level admin guard.
 */
@Module({
  imports: [FilesModule],
  controllers: [AdvertisementsController, AdminAdvertisementsController],
  providers: [AdvertisementsService],
})
export class AdvertisementsModule {}
