import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  NotFoundException,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { TreeService } from './tree.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { CacheNamespace } from '../cache/decorators/cache-namespace.decorator';
import { Cacheable } from '../cache/decorators/cacheable.decorator';

@Controller('tree')
@CacheNamespace('tree')
export class TreeController {
  constructor(private readonly tree: TreeService) {}

  @Cacheable({ ttlSeconds: 45, namespace: 'tree', scope: 'global' })
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

  @Cacheable({ ttlSeconds: 30, namespace: 'tree', scope: 'user' })
  @Get('downline/recent')
  @UseGuards(JwtAuthGuard)
  async getRecentDownline(@Req() req, @Query('limit') limit?: string) {
    return this.tree.getRecentDownline(req.user.id, Number(limit) || 20);
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 45, namespace: 'tree', scope: 'user' })
  @Get('referrals')
  async referrals(@Req() req) {
    return this.tree.getReferralTracking(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 45, namespace: 'tree', scope: 'user' })
  @Get('downline/rank')
  async rankDownline(@Req() req) {
    return this.tree.rankDownlineByBV(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('downline/members')
  async getDownlineMembersWithStats(
    @Req() req,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('memberId') memberId?: string,
  ) {
    const rootId =
      userId !== undefined && userId !== ''
        ? parseInt(userId, 10)
        : req.user.id;
    if (userId !== undefined && userId !== '' && isNaN(rootId)) {
      throw new BadRequestException('Invalid userId');
    }
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    const memberIdSearch =
      memberId !== undefined && memberId.trim() !== '' ? memberId : undefined;
    return this.tree.getDownlineMembersWithStats(
      rootId,
      req.user.id,
      req.user.role,
      pageNum,
      pageSizeNum,
      memberIdSearch,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('downline/sponsor-members')
  async getSponsorDownlineMembersWithStats(
    @Req() req,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('memberId') memberId?: string,
  ) {
    const rootId =
      userId !== undefined && userId !== ''
        ? parseInt(userId, 10)
        : req.user.id;
    if (userId !== undefined && userId !== '' && isNaN(rootId)) {
      throw new BadRequestException('Invalid userId');
    }
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    const memberIdSearch =
      memberId !== undefined && memberId.trim() !== '' ? memberId : undefined;
    return this.tree.getSponsorDownlineMembersWithStats(
      rootId,
      req.user.id,
      req.user.role,
      pageNum,
      pageSizeNum,
      memberIdSearch,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('downline/deposit-funds')
  async getDownlineDepositFunds(
    @Req() req,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
    return this.tree.getDownlineDepositFunds(req.user.id, pageNum, pageSizeNum);
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 20, namespace: 'tree', scope: 'user' })
  @Get('search/member')
  async searchMember(
    @Query('rootUserId') rootUserId: string,
    @Query('memberId') memberId: string,
  ) {
    const rootUser = parseInt(rootUserId);
    return this.tree.searchMemberIdInTree(rootUser, memberId);
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 20, namespace: 'tree', scope: 'user' })
  @Get('search/extreme-left')
  async extremeLeft(@Query('rootUserId') rootUserId: string) {
    const rootUser = parseInt(rootUserId);
    return this.tree.getExtremeLeftUser(rootUser);
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 20, namespace: 'tree', scope: 'user' })
  @Get('search/extreme-right')
  async extremeRight(@Query('rootUserId') rootUserId: string) {
    const rootUser = parseInt(rootUserId);
    return this.tree.getExtremeRightUser(rootUser);
  }

  @UseGuards(JwtAuthGuard)
  @Get('search/shift-up')
  async shiftUp(@Req() req, @Query('currentNodeUserId') currentNodeUserId: string) {
    const currentNodeId = parseInt(currentNodeUserId, 10);
    if (isNaN(currentNodeId)) {
      throw new BadRequestException('Invalid currentNodeUserId');
    }

    return this.tree.shiftUpWithinDownline(req.user.id, currentNodeId);
  }
}
