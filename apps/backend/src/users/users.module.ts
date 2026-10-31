import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { BillingAddressesService } from './billing-addresses.service';
import { UsersController } from './users.controller';
import { AccountPurgeService } from './account-purge.service';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // NotificationsModule is not @Global() by design, so a follow declaring it
  // here is the deliberate "this module now sends notifications" choice.
  imports: [FilesModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService, BillingAddressesService, AccountPurgeService],
  exports: [UsersService],
})
export class UsersModule {}
