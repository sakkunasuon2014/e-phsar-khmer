import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { UserReportsController } from './reports.controller';
import { UserReportsService } from './reports.service';

@Module({
  imports: [FilesModule],
  controllers: [UserReportsController],
  providers: [UserReportsService],
})
export class UserReportsModule {}
