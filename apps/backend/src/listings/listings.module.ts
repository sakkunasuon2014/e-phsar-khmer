import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { FilesModule } from '../files/files.module';
import { ReactionsModule } from '../reactions/reactions.module';
import { SubscriptionsCoreModule } from '../subscriptions/subscriptions-core.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductsModule } from '../products/products.module';
import { LISTING_EXPIRY_QUEUE } from './listing-expiry.constants';
import { ListingExpiryService } from './listing-expiry.service';
import {
  ListingExpiryProcessor,
  ListingExpiryScheduler,
} from './listing-expiry.processor';

@Module({
  imports: [
    FilesModule,
    ReactionsModule,
    SubscriptionsCoreModule,
    // Importing it is a choice to send notifications — the module is not
    // global. Its only dependency is the leaf `ChatPubSubModule`, so this
    // adds no cycle to the listings graph.
    NotificationsModule,
    // Trusted product specs: ListingsService validates `productModelId` and
    // embeds the product ref on the detail read.
    ProductsModule,
    BullModule.registerQueue({ name: LISTING_EXPIRY_QUEUE }),
  ],
  controllers: [ListingsController],
  providers: [
    ListingsService,
    ListingExpiryService,
    ListingExpiryScheduler,
    ListingExpiryProcessor,
  ],
  exports: [ListingsService],
})
export class ListingsModule {}
