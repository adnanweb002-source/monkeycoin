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
  BadRequestException,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AdminUsersService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApiKeyGuard } from 'src/auth/guards/api-key.guard';
import { PackagesCronService } from 'src/packages/packages.cron';
import { BinaryEngineService } from 'src/tree/binary-engine.service';
import { WalletService } from 'src/wallets/wallet.service';
import { SETTING_TYPE } from '@prisma/client';
import { CreateRankDto } from './dto/create-rank.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateDepositBonusDto } from './dto/create-deposit-bonus.dto';
import { UpdateDepositBonusDto } from './dto/update-deposit-bonus.dto';
import { AdminAdjustWalletBalanceDto } from './dto/admin-adjust-wallet-balance.dto';
import { AdminWalletAdjustChallengeDto } from './dto/admin-wallet-adjust-challenge.dto';
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
  suspend(@Param('userId') userId: string, @Req() req) {
    return this.svc.suspendUser(Number(userId), req.user.id);
  }

  @Patch(':userId/activate')
  activate(@Param('userId') userId: string, @Req() req) {
    return this.svc.activateUser(Number(userId), req.user.id);
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
  updateProfile(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
    @Req() req,
  ) {
    return this.svc.updateUserProfile(Number(userId), dto, req.user.id);
  }
}

@Controller('admin/')
@CacheNamespace('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminUsersService,
    private readonly cron: PackagesCronService,
    private readonly binaryEngine: BinaryEngineService,
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
    return this.runPackageDailyWithGuard();
  }

  @Post('manual-package-daily')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  manualPackageDaily() {
    return this.runPackageDailyWithGuard();
  }

  @Post('manual-binary-daily')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async manualBinaryDaily() {
    const dateKey = await this.binaryEngine.getBinaryPayoutDateKey();
    if (await this.binaryEngine.hasCompletedBinaryRunForDateKey(dateKey)) {
      throw new BadRequestException(
        'Binary daily run for the current business day has already been completed.',
      );
    }
    await this.binaryEngine.runDailyBinaryPayout();
    return {
      ok: true,
      message: 'Binary daily run completed.',
    };
  }

  private async runPackageDailyWithGuard() {
    const ymd = this.cron.getTorontoDateKey();
    if (await this.cron.hasCompletedPackageRunForDateKey(ymd)) {
      throw new BadRequestException(
        'Package daily run (credit + yield generation) for this Toronto business day has already been completed.',
      );
    }
    await this.cron.runDailyReturns();
    return { ok: true, message: 'Package daily run completed.' };
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
  upsertSetting(
    @Body('key') key: SETTING_TYPE,
    @Body('value') value: string,
    @Req() req,
  ) {
    return this.adminService.upsertSetting(key, value, req.user.id);
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
  @Post('seed-power-accounts')
  seedPowerAccounts() {
    return this.adminService.seedPowerAccounts();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('create-rank')
  createRank(@Body() dto: CreateRankDto, @Req() req) {
    return this.adminService.createRank(dto, req.user.id);
  }

  @Patch('/ranks/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  updateRank(@Param('id') id: number, @Body() dto: CreateRankDto, @Req() req) {
    return this.adminService.updateRank(Number(id), dto, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @InvalidateExtra({ namespaces: ['ranks'] })
  @Delete('/ranks/:id')
  deleteRank(@Param('id') id: number, @Req() req) {
    return this.adminService.deleteRank(Number(id), req.user.id);
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
  @Get('/growth/deposits')
  getDepositGrowth(
    @Query('days') days?: string,
    @Query('weeks') weeks?: string,
    @Query('months') months?: string,
  ) {
    return this.adminService.getDepositGrowth(
      days ? Number(days) : undefined,
      weeks ? Number(weeks) : undefined,
      months ? Number(months) : undefined,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('/growth/package-purchases')
  getPackagePurchaseGrowth(
    @Query('days') days?: string,
    @Query('weeks') weeks?: string,
    @Query('months') months?: string,
  ) {
    return this.adminService.getPackagePurchaseGrowth(
      days ? Number(days) : undefined,
      weeks ? Number(weeks) : undefined,
      months ? Number(months) : undefined,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('deposit-bonus')
  createDepositBonus(@Body() dto: CreateDepositBonusDto, @Req() req) {
    return this.adminService.createDepositBonus(dto, req.user.id);
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
    @Req() req,
  ) {
    return this.adminService.updateDepositBonus(id, dto, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('deposit-bonus/:id')
  deleteDepositBonus(@Param('id') id: number, @Req() req) {
    return this.adminService.deleteDepositBonus(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('audit-logs')
  getAuditLogs(
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('memberId') memberId?: string,
  ) {
    return this.adminService.getAuditLogs(
      Number(take ?? 20),
      Number(skip ?? 0),
      memberId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('package-purchases/with-e-wallet')
  listPackagePurchasesWithEWallet(
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('memberId') memberId?: string,
  ) {
    return this.adminService.listPackagePurchasesWithEWallet(
      Number(take ?? 20),
      Number(skip ?? 0),
      memberId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('package-purchases/:purchaseId')
  deletePackagePurchase(
    @Param('purchaseId') purchaseId: string,
    @Req() req,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.deletePackagePurchase(
      Number(purchaseId),
      req.user.id,
      reason,
    );
  }

  @UseGuards(ThrottlerGuard, JwtAuthGuard, RolesGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles(Role.ADMIN)
  @Post('wallets/adjust-balance/challenge')
  createWalletAdjustChallenge(
    @Body() dto: AdminWalletAdjustChallengeDto,
    @Req() req,
  ) {
    return this.adminService.adminCreateWalletAdjustChallenge(
      req.user.id,
      dto.memberId,
    );
  }

  @UseGuards(
    ThrottlerGuard,
    JwtAuthGuard,
    RolesGuard,
  )
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Roles(Role.ADMIN)
  @Post('wallets/adjust-balance')
  adjustUserWalletBalance(
    @Body() dto: AdminAdjustWalletBalanceDto,
    @Req() req,
  ) {
    return this.adminService.adminAdjustUserWalletBalance({
      adminId: req.user.id,
      memberId: dto.memberId,
      walletType: dto.walletType,
      balance: dto.balance,
      twoFactorCode: dto.twoFactorCode,
      keySalt: dto.keySalt,
      requestTs: dto.requestTs,
      dynamicKey: dto.dynamicKey,
      reason: dto.reason,
    });
  }
}
