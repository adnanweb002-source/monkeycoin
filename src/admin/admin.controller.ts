import {
  Controller,
  Patch,
  Param,
  UseGuards,
  Req,
  Post,
  Get,
  Body,
  Query,
} from '@nestjs/common';
import { AdminUsersService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';
import { PackagesCronService } from 'src/packages/packages.cron';
import { WalletService } from 'src/wallets/wallet.service';

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

  @Patch(':userId/restrict-withdrawal')
  restrictWithdrawal(
    @Param('userId') userId: string,
    @Req() req,
    @Body('restrict') restrict: boolean,
  ) {
    return this.svc.restrictUserWithdrawal(
      req.user.id,
      Number(userId),
      restrict,
    );
  }

  @Patch(':userId/set-password')
  setPassword(@Param('userId') userId: string, @Req() req) {
    return this.svc.adminSetPassword(
      req.user.id,
      Number(userId),
      req.body.password,
    );
  }
}

@Controller('admin/')
export class AdminController {
  constructor(
    private readonly adminService: AdminUsersService,
    private readonly cron: PackagesCronService,
    private readonly walletService: WalletService,
  ) {}

  @UseGuards(ApiKeyGuard)
  @Post('bootstrap/company')
  async bootstrapCompany() {
    return this.adminService.ensureCompanyAccount();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('get-wallet-limits')
  getWalletLimits() {
    return this.walletService.getWalletLimits();
  }

  
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('wallet-limits/upsert')
  async upsertWalletLimit(@Body() body: any) {
    return this.walletService.upsertWalletLimit(body);
  }

  @Post('run-daily-returns')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  runNow() {
    return this.cron.runDailyReturns();
  }

  @Post('prune-system')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  pruneSystem(@Req() req) {
    console.log("System prune requested with body:", req.body);
    if (!req.body.confirm || req.body.confirm !== 'PRUNE') {
      throw new Error(
        "Confirmation phrase 'PRUNE' not provided in request body",
      );
    }
    return this.adminService.pruneSystem(
      req.user.id,
      req.body.confirm
    );
  }
}
