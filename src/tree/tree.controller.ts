import { Controller, Get, Param, ParseIntPipe, Query, NotFoundException } from '@nestjs/common';
import { TreeService } from './tree.service';

@Controller('tree')
export class TreeController {
  constructor(private readonly tree: TreeService) {}

  // GET /tree/user/:id?depth=3
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
}
