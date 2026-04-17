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
  current_rank: string;
  total_package_amount: Decimal;
  totalLeft: number;
  totalRight: number;
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
  -- ❌ NO aggregates here
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
    u."currentRank",
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
    u."currentRank",
    sTree.lvl + 1
  FROM "users" u
  JOIN subtree sTree ON u.parent_id = sTree.id
  LEFT JOIN "users" p ON p.id = u.parent_id
  LEFT JOIN "users" s ON s.id = u.sponsor_id
  WHERE sTree.lvl + 1 <= ${depth}
),

-- ✅ Aggregate OUTSIDE recursion
package_totals AS (
  SELECT 
    "userId",
    COALESCE(SUM(amount), 0) as total_package_amount
  FROM "package_purchases"
  WHERE status = 'ACTIVE'
  GROUP BY "userId"
)

-- ✅ Final join
SELECT 
  s.*,
  COALESCE(pt.total_package_amount, 0) as total_package_amount,


  -- 🔴 TOTAL LEFT COUNT
  (
    WITH RECURSIVE left_tree AS (
      SELECT id
      FROM "users"
      WHERE parent_id = s.id AND position = 'LEFT'

      UNION ALL

      SELECT u.id
      FROM "users" u
      JOIN left_tree lt ON u.parent_id = lt.id
    )
    SELECT COUNT(*) FROM left_tree
  ) as "totalLeft",

  -- 🔵 TOTAL RIGHT COUNT
  (
    WITH RECURSIVE right_tree AS (
      SELECT id
      FROM "users"
      WHERE parent_id = s.id AND position = 'RIGHT'

      UNION ALL

      SELECT u.id
      FROM "users" u
      JOIN right_tree rt ON u.parent_id = rt.id
    )
    SELECT COUNT(*) FROM right_tree
  ) as "totalRight"

FROM subtree s
LEFT JOIN package_totals pt ON pt."userId" = s.id;
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

        currentRank: r.current_rank,

        totalPackageAmount: r.total_package_amount,

        left: null,
        right: null,

        totalLeft: Number(r.totalLeft ?? 0),
        totalRight: Number(r.totalRight ?? 0),
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

        createdAt: n.createdAt,
        currentRank: n.currentRank,
        totalPackageAmount: n.totalPackageAmount,
        totalLeft: n.totalLeft || 0,
        totalRight: n.totalRight || 0,
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
        avatarId: true,
        country: true,
        activePackageCount: true,
      },
    });
  }

  async getDownlineDepositFunds(userId: number, page = 1, pageSize = 20) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { memberId: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const memberId = user.memberId;

    const downLineDeposits = await this.prisma.externalDeposit.findMany({
      where: {
        user: {
          sponsor: { memberId: memberId },
        },
        status: 'finished',
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: true,
      },
    });

    const total = await this.prisma.externalDeposit.count({
      where: {
        user: {
          sponsor: { memberId: memberId },
        },
        status: 'finished',
      },
    });

    const totalPages = Math.ceil(total / pageSize);

    const totalAmount = await this.prisma.externalDeposit.aggregate({
      where: {
        user: {
          sponsor: { memberId: memberId },
        },
        status: 'finished',
      },
      _sum: { paidAmount: true },
    });

    return {
      data: downLineDeposits,
      totalAmount: totalAmount._sum.paidAmount || 0,
      total,
      page,
      totalPages,
    };
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

  async searchMemberIdInTree(rootUserId: number, memberId: string) {
    const result = await this.prisma.$queryRaw<{ id: number }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id, member_id
      FROM "users"
      WHERE id = ${rootUserId}

      UNION ALL

      SELECT u.id, u.member_id
      FROM "users" u
      JOIN subtree s ON u.parent_id = s.id
    )
    SELECT id FROM subtree
    WHERE member_id = ${memberId}
    LIMIT 1;
  `;

    if (!result.length) {
      throw new BadRequestException('Member not found in your tree');
    }

    return { userId: result[0].id };
  }

  async getExtremeLeftUser(rootUserId: number) {
    const result = await this.prisma.$queryRaw<{ id: number }[]>`
    WITH RECURSIVE left_chain AS (
      SELECT id, parent_id
      FROM "users"
      WHERE id = ${rootUserId}

      UNION ALL

      SELECT u.id, u.parent_id
      FROM "users" u
      JOIN left_chain lc ON u.parent_id = lc.id
      WHERE u.position = 'LEFT'
    )
    SELECT id FROM left_chain
    ORDER BY id DESC
    LIMIT 1;
  `;

    return { userId: result[0]?.id ?? rootUserId };
  }
  async getExtremeRightUser(rootUserId: number) {
    const result = await this.prisma.$queryRaw<{ id: number }[]>`
    WITH RECURSIVE right_chain AS (
      SELECT id, parent_id
      FROM "users"
      WHERE id = ${rootUserId}

      UNION ALL

      SELECT u.id, u.parent_id
      FROM "users" u
      JOIN right_chain rc ON u.parent_id = rc.id
      WHERE u.position = 'RIGHT'
    )
    SELECT id FROM right_chain
    ORDER BY id DESC
    LIMIT 1;
  `;

    return { userId: result[0]?.id ?? rootUserId };
  }
}
