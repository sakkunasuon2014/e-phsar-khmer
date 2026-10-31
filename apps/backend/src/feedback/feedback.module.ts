import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import {
  AdminFeedbackController,
  FeedbackController,
} from './feedback.controller';
import { FeedbackService } from './feedback.service';

/**
 * Own module rather than AdminModule (same reasoning as AttributesModule): it
 * has a public surface — the Feedback page's submit — next to the admin list.
 */
@Module({
  imports: [AuthModule, FilesModule],
  controllers: [FeedbackController, AdminFeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
