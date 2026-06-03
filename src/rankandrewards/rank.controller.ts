import { Controller, Get, Post, Param, Request } from '@nestjs/common';
import { RankService } from './rank.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt.auth.guard';
import { CacheNamespace } from '../cache/decorators/cache-namespace.decorator';
import { Cacheable } from '../cache/decorators/cacheable.decorator';
import { InvalidateExtra } from '../cache/decorators/invalidate-extra.decorator';

@Controller('ranks')
@CacheNamespace('ranks')
export class RankController {

  constructor(private rankService: RankService) {}

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 120, namespace: 'ranks', scope: 'global' })
  @Get()
  async getAll() {
    return this.rankService.getAllRanks();
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 45, namespace: 'ranks', scope: 'user' })
  @Get("user")
  async getRanks(@Request() req) {
    return this.rankService.getUserRanks(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @InvalidateExtra({ namespaces: ['wallet', 'tree'] })
  @Post('claim/:rankId')
  async claim(
    @Param('rankId') rankId: number,
    @Request() req
  ) {
    return this.rankService.claimRank(req.user.id, Number(rankId));
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 30, namespace: 'ranks', scope: 'user' })
  @Get('progress')
  async progress(@Request() req) {
    return this.rankService.getRankProgress(req.user.id);
  }
}