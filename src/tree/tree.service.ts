import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Role } from '@prisma/client';
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
  constructor(private prisma: PrismaService) { }

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

  // async getDownlineDepositFunds(userId: number, page = 1, pageSize = 20) {
  //   const user = await this.prisma.user.findUnique({
  //     where: { id: userId },
  //     select: { id: true },
  //   });

  //   if (!user) {
  //     throw new BadRequestException('User not found');
  //   }

  //   const safePage = Math.max(1, page);
  //   const safePageSize = Math.max(1, pageSize);
  //   const skip = (safePage - 1) * safePageSize;

  //   const downlineRows = await this.prisma.$queryRaw<{ id: number }[]>`
  //       WITH RECURSIVE sponsor_tree AS (
  //         SELECT id FROM "users" WHERE id = ${userId}
  //         UNION ALL
  //         SELECT u.id
  //         FROM "users" u
  //         INNER JOIN sponsor_tree s ON u.parent_id = s.id
  //       )
  //       SELECT id FROM sponsor_tree WHERE id <> ${userId};
  //     `;

  //   const downlineUserIds = downlineRows.map((r) => r.id);

  //   if (downlineUserIds.length === 0) {
  //     return {
  //       data: [],
  //       totalAmount: 0,
  //       total: 0,
  //       page: safePage,
  //       totalPages: 0,
  //     };
  //   }

  //   const [downLineDeposits, total, totalAmount] =
  //     await this.prisma.$transaction([
  //       this.prisma.externalDeposit.findMany({
  //         where: {
  //           userId: { in: downlineUserIds },
  //           status: 'finished',
  //         },
  //         orderBy: { createdAt: 'desc' },
  //         skip,
  //         take: safePageSize,
  //         include: {
  //           user: true,
  //         },
  //       }),
  //       this.prisma.externalDeposit.count({
  //         where: {
  //           userId: { in: downlineUserIds },
  //           status: 'finished',
  //         },
  //       }),
  //       this.prisma.externalDeposit.aggregate({
  //         where: {
  //           userId: { in: downlineUserIds },
  //           status: 'finished',
  //         },
  //         _sum: { paidAmount: true },
  //       }),
  //     ]);

  //   return {
  //     data: downLineDeposits,
  //     totalAmount: totalAmount._sum.paidAmount || 0,
  //     total,
  //     page: safePage,
  //     totalPages: Math.ceil(total / safePageSize) || 0,
  //   };
  // }

  async getDownlineDepositFunds(userId: number, page = 1, pageSize = 20) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.max(1, Math.min(pageSize, 100));
    const skip = (safePage - 1) * safePageSize;

    const result = await this.prisma.$queryRaw<
      {
        id: number;
        paidAmount: Decimal;
        fiatAmount: Decimal;
        status: string;
        createdAt: Date;
        userId: number;
        first_name: string;
        last_name: string;
        member_id: string;

        total_count: number;
        total_amount: Decimal;
      }[]
      >`
    WITH RECURSIVE downline AS (
      SELECT id
      FROM "users"
      WHERE id = ${userId}
    
      UNION ALL
    
      SELECT u.id
      FROM "users" u
      INNER JOIN downline d ON u.parent_id = d.id
    ),
    
    downline_users AS (
      SELECT id FROM downline WHERE id <> ${userId}
    ),
    
    filtered_deposits AS (
      SELECT 
        e.*,
        u.first_name,
        u.last_name,
        u.member_id
      FROM "ExternalDeposit" e
      INNER JOIN downline_users d ON d.id = e."userId"
      INNER JOIN "users" u ON u.id = e."userId"
      WHERE e.status = 'finished'
    ),
    
    aggregates AS (
      SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(e."paidAmount"), 0) AS total_amount
      FROM filtered_deposits e
    ),
    
    paged AS (
      SELECT *
      FROM filtered_deposits
      ORDER BY "createdAt" DESC
      LIMIT ${safePageSize}
      OFFSET ${skip}
    )
    
    SELECT 
      p.*,
      a.total_count,
      a.total_amount
    FROM paged p
    CROSS JOIN aggregates a;
    `;

    if (!result.length) {
      return {
        data: [],
        totalAmount: 0,
        total: 0,
        page: safePage,
        totalPages: 0,
      };
    }

    const total = Number(result[0].total_count || 0);
    const totalAmount = new Decimal(result[0].total_amount || 0).toFixed();

    const data = result.map((r) => ({
      id: r.id,
      paidAmount: new Decimal(r.paidAmount).toFixed(),
      fiatAmount: new Decimal(r.fiatAmount).toFixed(),
      status: r.status,
      createdAt: r.createdAt,
      user: {
        id: r.userId,
        firstName: r.first_name,
        lastName: r.last_name,
        memberId: r.member_id,
      },
    }));

    return {
      data,
      totalAmount,
      total,
      page: safePage,
      totalPages: Math.ceil(total / safePageSize) || 0,
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

  async shiftUpWithinDownline(authUserId: number, currentNodeUserId: number) {
    if (!Number.isInteger(currentNodeUserId) || currentNodeUserId <= 0) {
      throw new BadRequestException('Invalid currentNodeUserId');
    }

    if (currentNodeUserId === authUserId) {
      throw new BadRequestException('You are already at your root node');
    }

    const currentNode = await this.prisma.user.findUnique({
      where: { id: currentNodeUserId },
      select: { id: true, parentId: true },
    });

    if (!currentNode) {
      throw new BadRequestException('Current node user not found');
    }

    const currentInDownline = await this.prisma.$queryRaw<{ id: number }[]>`
WITH RECURSIVE downline AS (
  SELECT id
  FROM "users"
  WHERE id = ${authUserId}

  UNION ALL

  SELECT u.id
  FROM "users" u
  INNER JOIN downline d ON u.parent_id = d.id
)
SELECT id
FROM downline
WHERE id = ${currentNodeUserId}
  AND id <> ${authUserId}
LIMIT 1;
`;

    if (!currentInDownline.length) {
      throw new ForbiddenException('Current node is not in your downline');
    }

    if (!currentNode.parentId) {
      throw new BadRequestException('Current node has no parent to shift up to');
    }

    const parentInDownline = await this.prisma.$queryRaw<{ id: number }[]>`
WITH RECURSIVE downline AS (
  SELECT id
  FROM "users"
  WHERE id = ${authUserId}

  UNION ALL

  SELECT u.id
  FROM "users" u
  INNER JOIN downline d ON u.parent_id = d.id
)
SELECT id
FROM downline
WHERE id = ${currentNode.parentId}
  AND id <> ${authUserId}
LIMIT 1;
`;

    if (!parentInDownline.length) {
      throw new ForbiddenException(
        'Cannot shift above your allowed downline boundary',
      );
    }

    return { userId: currentNode.parentId };
  }

  /**
   * Binary placement downline: all descendants under `rootUserId` (via parent_id), excluding the root.
   * Totals match admin user list: finished external deposits (fiat), approved withdrawals, active package purchases.
   */
  async getDownlineMembersWithStats(
    rootUserId: number,
    requesterId: number,
    requesterRole: Role,
    page = 1,
    pageSize = 20,
  ) {
    if (rootUserId !== requesterId && requesterRole !== Role.ADMIN) {
      throw new ForbiddenException(
        'You can only view downline for your own account',
      );
    }

    const maxPageSize = 100;
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), maxPageSize);
    const skip = (safePage - 1) * safePageSize;

    const root = await this.prisma.user.findUnique({
      where: { id: rootUserId },
      select: { id: true },
    });
    if (!root) {
      throw new BadRequestException('User not found');
    }

    type Row = {
      full_total: number;
      id: number;
      member_id: string;
      first_name: string;
      last_name: string;
      email: string;
      phone_number: string | null;
      status: string;
      position: string | null;
      sponsor_id: number | null;
      created_at: Date;
      avatar_id: string;
      current_rank: number;
      active_package_count: number;
      total_deposits: Decimal | null;
      total_withdrawals: Decimal | null;
      total_package_amount: Decimal | null;
    };

    const rows = await this.prisma.$queryRaw<Row[]>`
WITH RECURSIVE downline AS (
  SELECT
    u.id,
    u.parent_id,
    u.member_id,
    u.first_name,
    u.last_name,
    u.email,
    u.phone_number,
    u.status,
    u.position::text AS position,
    u.sponsor_id,
    u.created_at,
    u.avatar_id,
    u."currentRank" AS current_rank,
    u."activePackageCount" AS active_package_count
  FROM "users" u
  WHERE u.id = ${rootUserId}

  UNION ALL

  SELECT
    u.id,
    u.parent_id,
    u.member_id,
    u.first_name,
    u.last_name,
    u.email,
    u.phone_number,
    u.status,
    u.position::text AS position,
    u.sponsor_id,
    u.created_at,
    u.avatar_id,
    u."currentRank" AS current_rank,
    u."activePackageCount" AS active_package_count
  FROM "users" u
  INNER JOIN downline d ON u.parent_id = d.id
),
downline_rows AS (
  SELECT * FROM downline WHERE id <> ${rootUserId}
),
numbered AS (
  SELECT
    dr.*,
    (COUNT(*) OVER ())::int AS full_total,
    ROW_NUMBER() OVER (ORDER BY dr.created_at DESC) AS rn
  FROM downline_rows dr
),
paged AS (
  SELECT * FROM numbered n
  WHERE n.rn > ${skip} AND n.rn <= ${skip + safePageSize}
),
deposit_totals AS (
  SELECT
    e."userId",
    COALESCE(SUM(e."fiatAmount"), 0)::decimal(65, 30) AS total_deposits
  FROM "ExternalDeposit" e
  INNER JOIN paged p ON p.id = e."userId"
  WHERE e.status = 'finished'
  GROUP BY e."userId"
),
withdrawal_totals AS (
  SELECT
    w."userId",
    COALESCE(SUM(w.amount), 0)::decimal(65, 30) AS total_withdrawals
  FROM withdrawal_requests w
  INNER JOIN paged p ON p.id = w."userId"
  WHERE w.status = 'APPROVED'
  GROUP BY w."userId"
),
package_totals AS (
  SELECT
    pp."userId",
    COALESCE(SUM(pp.amount), 0)::decimal(65, 30) AS total_package_amount
  FROM package_purchases pp
  INNER JOIN paged p ON p.id = pp."userId"
  WHERE pp.status = 'ACTIVE'
  GROUP BY pp."userId"
)
SELECT
  p.full_total,
  p.id,
  p.member_id,
  p.first_name,
  p.last_name,
  p.email,
  p.phone_number,
  p.status,
  p.position,
  p.sponsor_id,
  p.created_at,
  p.avatar_id,
  p.current_rank,
  p.active_package_count,
  COALESCE(dt.total_deposits, 0) AS total_deposits,
  COALESCE(wt.total_withdrawals, 0) AS total_withdrawals,
  COALESCE(pt.total_package_amount, 0) AS total_package_amount
FROM paged p
LEFT JOIN deposit_totals dt ON dt."userId" = p.id
LEFT JOIN withdrawal_totals wt ON wt."userId" = p.id
LEFT JOIN package_totals pt ON pt."userId" = p.id
ORDER BY p.created_at DESC;
`;

    let total = rows[0]?.full_total ?? 0;
    if (rows.length === 0) {
      const countOnly = await this.prisma.$queryRaw<{ c: bigint }[]>`
WITH RECURSIVE downline AS (
  SELECT u.id, u.parent_id
  FROM "users" u
  WHERE u.id = ${rootUserId}
  UNION ALL
  SELECT u.id, u.parent_id
  FROM "users" u
  INNER JOIN downline d ON u.parent_id = d.id
)
SELECT COUNT(*)::bigint AS c
FROM downline
WHERE id <> ${rootUserId};
`;
      total = Number(countOnly[0]?.c ?? 0);
      return {
        data: [],
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.ceil(total / safePageSize) || 0,
      };
    }

    const data = rows.map((r) => ({
      id: r.id,
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      phoneNumber: r.phone_number,
      status: r.status,
      position: r.position as 'LEFT' | 'RIGHT' | null,
      sponsorId: r.sponsor_id,
      createdAt: r.created_at,
      avatarId: r.avatar_id,
      currentRank: r.current_rank,
      activePackageCount: r.active_package_count,
      totalDeposits: new Decimal(r.total_deposits ?? 0).toFixed(),
      totalWithdrawals: new Decimal(r.total_withdrawals ?? 0).toFixed(),
      totalPackageAmount: new Decimal(r.total_package_amount ?? 0).toFixed(),
    }));

    return {
      data,
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize) || 0,
    };
  }

  /**
   * Sponsor / referral downline: all users in the sponsor genealogy under `rootUserId`
   * (transitive via sponsor_id), excluding the root. Same aggregates as {@link getDownlineMembersWithStats}.
   */
  async getSponsorDownlineMembersWithStats(
    rootUserId: number,
    requesterId: number,
    requesterRole: Role,
    page = 1,
    pageSize = 20,
  ) {
    if (rootUserId !== requesterId && requesterRole !== Role.ADMIN) {
      throw new ForbiddenException(
        'You can only view downline for your own account',
      );
    }

    const maxPageSize = 100;
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), maxPageSize);
    const skip = (safePage - 1) * safePageSize;

    const root = await this.prisma.user.findUnique({
      where: { id: rootUserId },
      select: { id: true },
    });
    if (!root) {
      throw new BadRequestException('User not found');
    }

    type Row = {
      full_total: number;
      id: number;
      member_id: string;
      first_name: string;
      last_name: string;
      email: string;
      phone_number: string | null;
      status: string;
      position: string | null;
      sponsor_id: number | null;
      created_at: Date;
      avatar_id: string;
      current_rank: number;
      active_package_count: number;
      total_deposits: Decimal | null;
      total_withdrawals: Decimal | null;
      total_package_amount: Decimal | null;
    };

    const rows = await this.prisma.$queryRaw<Row[]>`
WITH RECURSIVE downline AS (
  SELECT
    u.id,
    u.parent_id,
    u.member_id,
    u.first_name,
    u.last_name,
    u.email,
    u.phone_number,
    u.status,
    u.position::text AS position,
    u.sponsor_id,
    u.created_at,
    u.avatar_id,
    u."currentRank" AS current_rank,
    u."activePackageCount" AS active_package_count
  FROM "users" u
  WHERE u.id = ${rootUserId}

  UNION ALL

  SELECT
    u.id,
    u.parent_id,
    u.member_id,
    u.first_name,
    u.last_name,
    u.email,
    u.phone_number,
    u.status,
    u.position::text AS position,
    u.sponsor_id,
    u.created_at,
    u.avatar_id,
    u."currentRank" AS current_rank,
    u."activePackageCount" AS active_package_count
  FROM "users" u
  INNER JOIN downline d ON u.sponsor_id = d.id
),
downline_rows AS (
  SELECT * FROM downline WHERE id <> ${rootUserId}
),
numbered AS (
  SELECT
    dr.*,
    (COUNT(*) OVER ())::int AS full_total,
    ROW_NUMBER() OVER (ORDER BY dr.created_at DESC) AS rn
  FROM downline_rows dr
),
paged AS (
  SELECT * FROM numbered n
  WHERE n.rn > ${skip} AND n.rn <= ${skip + safePageSize}
),
deposit_totals AS (
  SELECT
    e."userId",
    COALESCE(SUM(e."fiatAmount"), 0)::decimal(65, 30) AS total_deposits
  FROM "ExternalDeposit" e
  INNER JOIN paged p ON p.id = e."userId"
  WHERE e.status = 'finished'
  GROUP BY e."userId"
),
withdrawal_totals AS (
  SELECT
    w."userId",
    COALESCE(SUM(w.amount), 0)::decimal(65, 30) AS total_withdrawals
  FROM withdrawal_requests w
  INNER JOIN paged p ON p.id = w."userId"
  WHERE w.status = 'APPROVED'
  GROUP BY w."userId"
),
package_totals AS (
  SELECT
    pp."userId",
    COALESCE(SUM(pp.amount), 0)::decimal(65, 30) AS total_package_amount
  FROM package_purchases pp
  INNER JOIN paged p ON p.id = pp."userId"
  WHERE pp.status = 'ACTIVE'
  GROUP BY pp."userId"
)
SELECT
  p.full_total,
  p.id,
  p.member_id,
  p.first_name,
  p.last_name,
  p.email,
  p.phone_number,
  p.status,
  p.position,
  p.sponsor_id,
  p.created_at,
  p.avatar_id,
  p.current_rank,
  p.active_package_count,
  COALESCE(dt.total_deposits, 0) AS total_deposits,
  COALESCE(wt.total_withdrawals, 0) AS total_withdrawals,
  COALESCE(pt.total_package_amount, 0) AS total_package_amount
FROM paged p
LEFT JOIN deposit_totals dt ON dt."userId" = p.id
LEFT JOIN withdrawal_totals wt ON wt."userId" = p.id
LEFT JOIN package_totals pt ON pt."userId" = p.id
ORDER BY p.created_at DESC;
`;

    let total = rows[0]?.full_total ?? 0;
    if (rows.length === 0) {
      const countOnly = await this.prisma.$queryRaw<{ c: bigint }[]>`
WITH RECURSIVE downline AS (
  SELECT u.id, u.sponsor_id
  FROM "users" u
  WHERE u.id = ${rootUserId}
  UNION ALL
  SELECT u.id, u.sponsor_id
  FROM "users" u
  INNER JOIN downline d ON u.sponsor_id = d.id
)
SELECT COUNT(*)::bigint AS c
FROM downline
WHERE id <> ${rootUserId};
`;
      total = Number(countOnly[0]?.c ?? 0);
      return {
        data: [],
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.ceil(total / safePageSize) || 0,
      };
    }

    const data = rows.map((r) => ({
      id: r.id,
      memberId: r.member_id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      phoneNumber: r.phone_number,
      status: r.status,
      position: r.position as 'LEFT' | 'RIGHT' | null,
      sponsorId: r.sponsor_id,
      createdAt: r.created_at,
      avatarId: r.avatar_id,
      currentRank: r.current_rank,
      activePackageCount: r.active_package_count,
      totalDeposits: new Decimal(r.total_deposits ?? 0).toFixed(),
      totalWithdrawals: new Decimal(r.total_withdrawals ?? 0).toFixed(),
      totalPackageAmount: new Decimal(r.total_package_amount ?? 0).toFixed(),
    }));

    return {
      data,
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize) || 0,
    };
  }
}
