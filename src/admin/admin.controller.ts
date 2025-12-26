import {Controller, Patch, Param, UseGuards, Req, Post, Get, Query } from '@nestjs/common';
import { AdminUsersService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get('list')
  getAllUsers(@Query('take') take: string, @Query('skip') skip: string) {
    console.log('take, skip', take, skip);
    return this.svc.getAllUsers(Number(take), Number(skip));
  }

  @Patch(':userId/suspend')
  suspend(@Param('userId') userId: string) {
    return this.svc.suspendUser(Number(userId));
  }

  @Patch(':userId/activate')
  activate(@Param('userId') userId: string) {
    return this.svc.activateUser(Number(userId));
  }

  @Patch(':userId/disable-2fa')
  disable2fa(@Param('userId') userId: string, @Req() req) {
    return this.svc.adminDisable2fa(req.user.id, Number(userId));
  }

  @Patch(':userId/set-password')
  setPassword(@Param('userId') userId: string, @Req() req) {
    return this.svc.adminSetPassword(req.user.id, Number(userId), req.body.password);
  }

}

@Controller('admin/')
@UseGuards(ApiKeyGuard)
export class AdminController {
  constructor(private readonly adminService: AdminUsersService) {}

   @Post('bootstrap/company')
  async bootstrapCompany() {
    return this.adminService.ensureCompanyAccount();
  }
}