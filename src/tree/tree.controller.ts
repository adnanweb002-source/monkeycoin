import { Controller, Get, Param, ParseIntPipe, Query, NotFoundException, Req } from '@nestjs/common';
import { TreeService } from './tree.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';

@Controller('tree')
export class TreeController {
  constructor(private readonly tree: TreeService) {}

  @Get('user/:id')
  @UseGuards(JwtAuthGuard)
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
}