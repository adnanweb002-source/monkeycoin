import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { TreeService } from './tree.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';

@Controller('tree')
export class TreeController {
  constructor(private readonly tree: TreeService) {}

  @Get('user/:id')
  async getUserTree(
    @Param('id', ParseIntPipe) id: number,
    @Query('depth') depth?: string,
  ) {
    const maxDepth = depth ? Math.max(1, parseInt(depth, 10)) : undefined;
    const data = await this.tree.getUserTreeRecursive(id, maxDepth);
    if (!data) throw new NotFoundException('User not found');
    return data;
  }

  @Get('downline/recent')
  @UseGuards(JwtAuthGuard)
  async getRecentDownline(@Req() req, @Query('limit') limit?: string) {
    return this.tree.getRecentDownline(req.user.id, Number(limit) || 20);
  }

  @UseGuards(JwtAuthGuard)
  @Get('referrals')
  async referrals(@Req() req) {
    return this.tree.getReferralTracking(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('downline/rank')
  async rankDownline(@Req() req) {
    return this.tree.rankDownlineByBV(req.user.id);
  }
  
  @UseGuards(JwtAuthGuard)
  @Get('downline/deposit-funds')
  async getDownlineDepositFunds(@Req() req, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    return this.tree.getDownlineDepositFunds(req.user.id, pageNum, pageSizeNum);
  }
}
