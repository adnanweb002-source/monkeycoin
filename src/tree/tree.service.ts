import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import Decimal from 'decimal.js';

type DbRow = {
  id: number;
  first_name: string;
  last_name: string;
  left_bv: Decimal;
  right_bv: Decimal;
  phone_number: string | null;
  member_id: string | null;
  email: string | null;
  parent_id: number | null;
  parent_member_id: string | null;
  sponsor_member_id: string | null;
  position: 'LEFT' | 'RIGHT' | null;
  status: string | null;
  sponsor_id: number | null;
  created_at: Date;
  active_package_count: number | null;
  avatar_id: string;
};

@Injectable()
export class TreeService {
  constructor(private prisma: PrismaService) {}

  /**
   * Returns a nested binary tree for userId.
   * - depth: optional maximum depth (1 = only the node, 2 = children, 3 = grandchildren, etc.)
   */
  async getUserTreeRecursive(userId: number, depth?: number) {
    if (depth !== undefined && (isNaN(depth) || depth < 1)) {
      throw new BadRequestException('depth must be a positive integer');
    }

    // Safety: enforce a hard maximum depth to avoid runaway queries (adjust as needed)
    const HARD_MAX_DEPTH = 8;
    if (depth === undefined) depth = HARD_MAX_DEPTH;
    depth = Math.min(depth, HARD_MAX_DEPTH);

    // Use a parameterized raw query with WITH RECURSIVE.
    // We also compute level to enforce depth on the server side.
    const rows = await this.prisma.$queryRaw<DbRow[]>`
    WITH RECURSIVE subtree AS (
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.left_bv,
        u.right_bv,
        u.phone_number,
        u.member_id,
        u.email,
        u.parent_id,
        u.sponsor_id,
        p.member_id AS parent_member_id,
        s.member_id AS sponsor_member_id,
        u.position,
        u.status,
        u.created_at,
        u."activePackageCount" as active_package_count,
        u.avatar_id,
        1 AS lvl
      FROM "users" u
      LEFT JOIN "users" p ON p.id = u.parent_id
      LEFT JOIN "users" s ON s.id = u.sponsor_id
      WHERE u.id = ${userId}

      UNION ALL

      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.left_bv,
        u.right_bv,
        u.phone_number,
        u.member_id,
        u.email,
        u.parent_id,
        u.sponsor_id,
        p.member_id AS parent_member_id,
        s.member_id AS sponsor_member_id,
        u.position,
        u.status,
        u.created_at,
        u."activePackageCount" as active_package_count,
        u.avatar_id,
        sTree.lvl + 1
      FROM "users" u
      JOIN subtree sTree ON u.parent_id = sTree.id
      LEFT JOIN "users" p ON p.id = u.parent_id
      LEFT JOIN "users" s ON s.id = u.sponsor_id
      WHERE sTree.lvl + 1 <= ${depth}
    )
    SELECT * FROM subtree;
  `;

    if (!rows?.length) return null;

    const map = new Map<number, any>();

    rows.forEach((r) => {
      map.set(r.id, {
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        leftBv: r.left_bv,
        rightBv: r.right_bv,
        memberId: r.member_id,
        email: r.email ?? undefined,
        position: r.position as 'LEFT' | 'RIGHT' | null,
        isActive: r.status === 'ACTIVE',

        parentId: r.parent_id ?? null,
        sponsorId: r.sponsor_id ?? null,

        parentMemberId: r.parent_member_id ?? null,
        sponsorMemberId: r.sponsor_member_id ?? null,

        createdAt: r.created_at,

        active_package_count: r.active_package_count,

        avatar_id: r.avatar_id,

        left: null,
        right: null,
      });
    });

    // assign children
    for (const node of map.values()) {
      if (!node.parentId) continue;
      const parent = map.get(node.parentId);
      if (!parent) continue;

      if (node.position === 'RIGHT') parent.right = node;
      else parent.left = node;
    }

    const root = map.get(userId);

    const convertNode = (n: any) => {
      if (!n) return null;
      return {
        id: n.id,
        firstName: n.firstName,
        lastName: n.lastName,
        leftBv: n.leftBv,
        rightBv: n.rightBv,
        memberId: n.memberId,
        email: n.email,
        position: n.position,
        isActive: n.isActive,
        activePackageCount: n.active_package_count,
        parent: n.parentId ? { id: n.parentId } : null,

        parentMemberId: n.parentMemberId,
        sponsorMemberId: n.sponsorMemberId,

        leftChild: n.left ? convertNode(n.left) : null,
        rightChild: n.right ? convertNode(n.right) : null,

        avatarId: n.avatar_id,

      };
    };

    return convertNode(root);
  }

  async getRecentDownline(userId: number, limit = 20) {
    const queue = [userId];
    const downlineIds: number[] = [];

    while (queue.length) {
      const id = queue.shift();
      const children = await this.prisma.user.findMany({
        where: { sponsorId: id },
        select: { id: true },
      });

      for (const c of children) {
        downlineIds.push(c.id);
        queue.push(c.id);
      }
    }

    return this.prisma.user.findMany({
      where: { id: { in: downlineIds } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        memberId: true,
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
        sponsorId: true,
        parentId: true,
        position: true,
        status: true,
        avatarId: true
      },
    });
  }

  async getReferralTracking(userId: number) {
    const directReferrals = await this.prisma.user.findMany({
      where: { sponsorId: userId },
      select: {
        id: true,
        memberId: true,
        firstName: true,
        email: true,
        lastName: true,
        status: true,
        createdAt: true,
        packagePurchases: {
          where: { status: 'ACTIVE' },
          select: { amount: true, packageId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      directCount: directReferrals.length,
      directReferrals,
    };
  }

  async rankDownlineByBV(rootUserId: number) {
    const users = await this.prisma.user.findMany({
      where: { parentId: rootUserId },
      include: {
        children: true,
      },
    });

    // later you can recursively compute team BV
    return users
      .map((u) => ({
        userId: u.id,
        memberId: u.memberId,
        teamBV: new Decimal(u.leftBv.toString())
          .plus(u.rightBv.toString())
          .toFixed(),
      }))
      .sort((a, b) => Number(b.teamBV) - Number(a.teamBV));
  }
}
