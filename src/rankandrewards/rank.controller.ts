import { Controller, Get, Post, Param, Request } from '@nestjs/common';
import { RankService } from './rank.service';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt.auth.guard';

@Controller('ranks')
export class RankController {

  constructor(private rankService: RankService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async getAll() {
    return this.rankService.getAllRanks();
  }

  @UseGuards(JwtAuthGuard)
  @Get("user")
  async getRanks(@Request() req) {
    return this.rankService.getUserRanks(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('claim/:rankId')
  async claim(
    @Param('rankId') rankId: number,
    @Request() req
  ) {
    return this.rankService.claimRank(req.user.id, Number(rankId));
  }

  @UseGuards(JwtAuthGuard)
  @Get('progress')
  async progress(@Request() req) {
    return this.rankService.getRankProgress(req.user.id);
  }
}