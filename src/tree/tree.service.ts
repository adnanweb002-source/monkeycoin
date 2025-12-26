import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type DbRow = {
  id: number;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  member_id: string | null;
  email: string | null;
  parent_id: number | null;
  position: 'LEFT' | 'RIGHT' | null;
  status: string | null;
  sponsor_id: number | null;
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
          id,
          first_name,
          last_name,
          phone_number,
          member_id,
          email,
          parent_id,
          position,
          status,
          sponsor_id,
          1 as lvl
        FROM "users"
        WHERE id = ${userId}

        UNION ALL

        SELECT
          u.id,
          u.first_name,
          u.last_name,
          u.phone_number,
          u.member_id,
          u.email,
          u.parent_id,
          u.position,
          u.status,
          u.sponsor_id,
          s.lvl + 1
        FROM "users" u
        JOIN subtree s ON u.parent_id = s.id
        WHERE s.lvl + 1 <= ${depth}
      )
      SELECT id, first_name, last_name, member_id, email, parent_id, position, status, sponsor_id
      FROM subtree;
    `;

    if (!rows || rows.length === 0) return null;

    // Build a lookup map by id
    const map = new Map<number, any>();
    rows.forEach((r) => {
      map.set(r.id, {
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        memberId: r.member_id ?? undefined,
        email: r.email ?? undefined,
        position: r.position as 'LEFT' | 'RIGHT' | null,
        isActive: r.status === 'ACTIVE',
        parentId: r.parent_id ?? null,
        sponsorId: r.sponsor_id ?? null,
        left: null,
        right: null,
      });
    });

    // Assign children based on parentId and position
    for (const node of map.values()) {
      if (node.parentId) {
        const parent = map.get(node.parentId);
        if (!parent) continue; // parent might be outside requested depth
        if (node.position === 'RIGHT') {
          parent.right = node;
        } else {
          // default to LEFT when null or 'LEFT'
          parent.left = node;
        }
      }
    }

    // Root is the entry userId
    const root = map.get(userId);

    // Populate sponsor object for root if available
    if (root && root.sponsorId) {
      const sponsorRow = await this.prisma.user.findUnique({
        where: { id: root.sponsorId },
        select: { id: true, phoneNumber: true, memberId: true },
      });
      if (sponsorRow) {
        root.sponsor = {
          id: sponsorRow.id,
          phone: sponsorRow.phoneNumber,
          memberId: sponsorRow.memberId,
        };
      }
    }

    // Convert internal structure into the TreeUser shape expected by frontend.
    const convertNode = (n: any) => {
      if (!n) return null;
      return {
        id: n.id,
        username: n.username,
        memberId: n.memberId,
        email: n.email,
        position: n.position,
        isActive: n.isActive,
        parent: n.parentId ? { id: n.parentId } : null,
        leftChild: n.left ? convertNode(n.left) : null,
        rightChild: n.right ? convertNode(n.right) : null,
        sponsor: n.sponsor ? n.sponsor : null,
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
      where: { parentId: id },
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
    },
  });
}

}
