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
    return this.utility.replyToQueryAdmin(req.user.id, Number(id), dto.message);
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
    @Body()
    body: {
      title: string;
      date: string;
      type: string;
    },
  ) {
    return this.utility.createHoliday({
      ...body,
      date: new Date(body.date),
    });
  }

  // 👑 ADMIN — UPDATE HOLIDAY
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Put('holidays/:id')
  async updateHoliday(
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      date?: string;
      type?: string;
    },
  ) {
    return this.utility.updateHoliday(Number(id), {
      ...body,
      date: body.date ? new Date(body.date) : undefined,
    });
  }

  // 👑 ADMIN — DELETE HOLIDAY
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('holidays/:id')
  async deleteHoliday(@Param('id') id: string) {
    return this.utility.deleteHoliday(Number(id));
  }
}
