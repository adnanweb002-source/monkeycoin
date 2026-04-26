import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Query,
  Post,
} from '@nestjs/common';
import { TargetsService } from './targets.service';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { UpdateTargetDto } from './dto/update-target.dto';
import { TargetsQueryDto } from './dto/targets-query.dto';
import { AssignTargetDto } from './dto/assign-target.dto';

@Controller('targets')
export class TargetsController {
  constructor(private readonly targetsService: TargetsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  listAllTargets(@Query() query: TargetsQueryDto) {
    return this.targetsService.listAllTargets(query);
  }

  @Post('assign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  assignTarget(@Req() req, @Body() dto: AssignTargetDto) {
    return this.targetsService.assignTarget(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id')
  updateTarget(@Param('id') id: string, @Body() dto: UpdateTargetDto, @Req() req) {
    return this.targetsService.updateTarget(Number(id), dto, req.user.id);
  }

  // ADMIN — delete target
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete(':id')
  deleteTarget(@Param('id') id: string, @Req() req) {
    return this.targetsService.deleteTarget(Number(id), req.user.id);
  }

  // ADMIN - stats
  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getStats() {
    return this.targetsService.getTargetStats();
  }

  @Get('/business-volume')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getTargetBusinessVolume() {
    return this.targetsService.getTargetBusinessVolumeStats();
  }

  // USER — list own targets
  @UseGuards(JwtAuthGuard)
  @Get('/my')
  listUserTargets(@Req() req) {
    return this.targetsService.listUserTargets(req.user.id);
  }
}
