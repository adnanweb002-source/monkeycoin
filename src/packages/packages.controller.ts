import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PackagesService } from './packages.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { PurchasePackageDto } from './dto/purchase-package.dto';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { WalletType } from '@prisma/client';
import { CacheNamespace } from '../cache/decorators/cache-namespace.decorator';
import { Cacheable } from '../cache/decorators/cacheable.decorator';
import { InvalidateExtra } from '../cache/decorators/invalidate-extra.decorator';

@Controller('packages')
@CacheNamespace('packages')
export class PackagesController {
  constructor(private service: PackagesService) {}

  // -------- ADMIN: CREATE PACKAGE --------
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreatePackageDto) {
    return this.service.createPackage(dto);
  }

  // -------- ADMIN: UPDATE PACKAGE --------
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.service.updatePackage(Number(id), dto);
  }

  // -------- USER: LIST ACTIVE PACKAGES --------
  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 60, namespace: 'packages', scope: 'global' })
  @Get()
  listActive() {
    return this.service.listActivePackages();
  }

  // -------- USER: PURCHASE PACKAGE --------
  @UseGuards(JwtAuthGuard)
  @InvalidateExtra({ namespaces: ['wallet', 'tree'] })
  @Post('purchase')
  purchase(@Req() req, @Body() dto: PurchasePackageDto) {
    return this.service.purchasePackage(req.user.id, req.user.role, dto);
  }

  // -------- USER: MY PACKAGES --------
  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 30, namespace: 'packages', scope: 'user' })
  @Get('my')
  myPackages(@Req() req) {
    return this.service.listUserPackages(req.user.id);
  }

  // -------- USER: MY PACKAGES --------
  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 120, namespace: 'packages', scope: 'global' })
  @Get('wallet-rules')
  getWalletRules(@Req() req) {
    return this.service.getPackageWalletRules();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('wallet-rules')
  setWalletRules(
    @Req() req,
    @Body() body: { wallet: WalletType; minPct: Decimal },
  ) {
    return this.service.upsertPackageWalletRule(body.wallet, body.minPct);
  }
}
