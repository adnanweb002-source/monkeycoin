import {
  Controller,
  Body,
  Param,
  UseGuards,
  Req,
  Post,
  Get,
  Query,
  Delete,
  Put,
} from '@nestjs/common';
import { UtilityService } from './utility.service';
import { holidayDateFromInput } from '../common/toronto-time';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';

@Controller('utility')
export class UtilityController {
  constructor(private readonly utility: UtilityService) {}

  @Post('queries')
  @UseGuards(JwtAuthGuard)
  submitQuery(@Req() req, @Body() dto) {
    return this.utility.submitQuery(req.user.id, dto.message);
  }

  @Post('queries/:id/reply')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  replyQuery(@Param('id') id, @Body() dto, @Req() req) {
    return this.utility.replyToQueryAdmin(req.user.id, Number(id), dto.message, dto.shouldClose ?? false);
  }

  @Post('queries/:id/reply/user')
  @UseGuards(JwtAuthGuard)
  replyQueryUser(@Param('id') id, @Body() dto, @Req() req) {
    return this.utility.replyToQueryUser(req.user.id, Number(id), dto.message);
  }

  @Get('queries')
  @UseGuards(JwtAuthGuard)
  getUserQueries(@Req() req, @Query('skip') skip, @Query('take') take) {
    return this.utility.getUserQueries(req.user.id, Number(skip), Number(take));
  }

  @Get('admin/queries')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  getAllQueries(@Query() q) {
    return this.utility.getAllQueries(Number(q.skip), Number(q.take), q.status);
  }

  // 👤 USER — VIEW HOLIDAYS
  @UseGuards(JwtAuthGuard)
  @Get('holidays')
  async getHolidays() {
    return this.utility.listHolidays();
  }

  // 👑 ADMIN — CREATE HOLIDAY
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('holidays')
  async createHoliday(
    @Req() req,
    @Body()
    body: {
      title: string;
      date: string;
      type: string;
    },
  ) {
    return this.utility.createHoliday(
      req.user.id,
      {
      ...body,
      date: holidayDateFromInput(body.date),
      },
    );
  }

  // 👑 ADMIN — UPDATE HOLIDAY
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Put('holidays/:id')
  async updateHoliday(
    @Param('id') id: string,
    @Req() req,
    @Body()
    body: {
      title?: string;
      date?: string;
      type?: string;
    },
  ) {
    return this.utility.updateHoliday(
      Number(id),
      {
        ...body,
        date: body.date ? holidayDateFromInput(body.date) : undefined,
      },
      req.user.id,
    );
  }

  // 👑 ADMIN — DELETE HOLIDAY
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('holidays/:id')
  async deleteHoliday(@Param('id') id: string, @Req() req) {
    return this.utility.deleteHoliday(Number(id), req.user.id);
  }
}
