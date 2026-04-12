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
  Delete,
} from '@nestjs/common';
import { AdminUsersService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';
import { PackagesCronService } from 'src/packages/packages.cron';
import { WalletService } from 'src/wallets/wallet.service';
import { SETTING_TYPE } from '@prisma/client';
import { CreateRankDto } from './dto/create-rank.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateDepositBonusDto } from './dto/create-deposit-bonus.dto';
import { UpdateDepositBonusDto } from './dto/update-deposit-bonus.dto';
import { CacheNamespace } from '../cache/decorators/cache-namespace.decorator';
import { Cacheable } from '../cache/decorators/cacheable.decorator';
import { InvalidateExtra } from '../cache/decorators/invalidate-extra.decorator';

@Controller('admin/users')
@CacheNamespace('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Cacheable({ ttlSeconds: 20, namespace: 'admin', scope: 'user' })
  @Get('list')
  getAllUsers(
    @Query('take') take: string,
    @Query('skip') skip: string,
    @Query('memberId') memberId?: string,
  ) {
    console.log('take, skip', take, skip);
    return this.svc.getAllUsers(
      Number(take),
      Number(skip),
      memberId,
    );
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

  @Patch(':userId/restrict-cross-line-transfer')
  restrictCrossLineTransfer(
    @Param('userId') userId: string,
    @Req() req,
    @Body('restrict') restrict: boolean,
  ) {
    return this.svc.restrictUserCrossLineTransfer(
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
  @Patch(':userId/profile')
  updateProfile(@Param('userId') userId: string, @Body() dto: UpdateUserDto) {
    return this.svc.updateUserProfile(Number(userId), dto);
  }
}

@Controller('admin/')
@CacheNamespace('admin')
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
  @Cacheable({ ttlSeconds: 120, namespace: 'admin', scope: 'global' })
  @Get('get-wallet-limits')
  getWalletLimits() {
    return this.walletService.getWalletLimits();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @InvalidateExtra({ namespaces: ['wallet'] })
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
    console.log('System prune requested with body:', req.body);
    if (!req.body.confirm || req.body.confirm !== 'PRUNE') {
      throw new Error(
        "Confirmation phrase 'PRUNE' not provided in request body",
      );
    }
    return this.adminService.pruneSystem(req.user.id, req.body.confirm);
  }

  @Post('settings/upsert')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  upsertSetting(@Body('key') key: SETTING_TYPE, @Body('value') value: string) {
    return this.adminService.upsertSetting(key, value);
  }

  @Cacheable({ ttlSeconds: 60, namespace: 'admin', scope: 'user' })
  @Get('settings/get')
  @UseGuards(JwtAuthGuard)
  getSettings(@Query('key') key?: SETTING_TYPE) {
    return this.adminService.getSetting(key);
  }

  @Get('export-user-data')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  exportUserData() {
    return this.adminService.exportAllUserData();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @InvalidateExtra({ namespaces: ['ranks'] })
  @Post('create-rank')
  createRank(@Body() dto: CreateRankDto) {
    return this.adminService.createRank(dto);
  }

  @Patch('/ranks/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @InvalidateExtra({ namespaces: ['ranks'] })
  updateRank(@Param('id') id: number, @Body() dto: CreateRankDto) {
    return this.adminService.updateRank(Number(id), dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @InvalidateExtra({ namespaces: ['ranks'] })
  @Delete('/ranks/:id')
  deleteRank(@Param('id') id: number) {
    return this.adminService.deleteRank(Number(id));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Cacheable({ ttlSeconds: 30, namespace: 'admin', scope: 'user' })
  @Get('/stats')
  getStats() {
    return this.adminService.getStats();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('deposit-bonus')
  createDepositBonus(@Body() dto: CreateDepositBonusDto) {
    return this.adminService.createDepositBonus(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Cacheable({ ttlSeconds: 60, namespace: 'admin', scope: 'global' })
  @Get('deposit-bonus')
  listDepositBonuses() {
    return this.adminService.listDepositBonuses();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch('deposit-bonus/:id')
  updateDepositBonus(
    @Param('id') id: number,
    @Body() dto: UpdateDepositBonusDto,
  ) {
    return this.adminService.updateDepositBonus(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('deposit-bonus/:id')
  deleteDepositBonus(@Param('id') id: number) {
    return this.adminService.deleteDepositBonus(id);
  }
}
