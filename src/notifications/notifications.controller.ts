import {
  Controller,
  Get,
  Patch,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifcations.service';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  // GET /notifications?take=10&skip=0
  @Get()
  async getMyNotifications(
    @Req() req,
    @Query('take') take?: number,
    @Query('skip') skip?: number,
  ) {
    return this.notificationsService.getUserNotifications(
      req.user.id,
      Number(take) || 10,
      Number(skip) || 0,
    );
  }

  @Patch(':id/read')
  async markAsRead(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.notificationsService.markAsRead(req.user.id, id);
  }

  @Patch('read-all')
  async markAllAsRead(@Req() req) {
    return this.notificationsService.markAllAsRead(req.user.id);
  }
}