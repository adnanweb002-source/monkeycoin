import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { PackagesService } from './packages.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { PurchasePackageDto } from './dto/purchase-package.dto';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role} from '@prisma/client';

@Controller('packages')
export class PackagesController {
  constructor(private service: PackagesService) {}

  // -------- ADMIN: CREATE PACKAGE --------
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER)
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
  @Get()
  listActive() {
    return this.service.listActivePackages();
  }

  // -------- USER: PURCHASE PACKAGE --------
  @UseGuards(JwtAuthGuard)
  @Post('purchase')
  purchase(@Req() req, @Body() dto: PurchasePackageDto) {
    return this.service.purchasePackage(req.user.id, dto);
  }

  // -------- USER: MY PACKAGES --------
  @UseGuards(JwtAuthGuard)
  @Get('my')
  myPackages(@Req() req) {
    return this.service.listUserPackages(req.user.id);
  }
}
