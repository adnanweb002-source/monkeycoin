import { Module } from '@nestjs/common';
import { UtilityController } from './utility.controller';
import { UtilityService } from './utility.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [UtilityController],
  providers: [UtilityService, PrismaService],
  exports: [UtilityService],
})
export class UtilityModule {}
