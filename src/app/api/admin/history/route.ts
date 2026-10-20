import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { spins } from "@/db/schema";
import { desc, ilike, sql } from "drizzle-orm";
import { error, requireAdmin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requireAdmin())) return error("Não autorizado.", 401);
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const limit = 20;

  const whereClause = q ? ilike(spins.sectorName, `%${q}%`) : undefined;

  const [count] = whereClause
    ? await db.select({ value: sql<number>`count(*)::int` }).from(spins).where(whereClause)
    : await db.select({ value: sql<number>`count(*)::int` }).from(spins);

  const items = whereClause
    ? await db
        .select()
        .from(spins)
        .where(whereClause)
        .orderBy(desc(spins.createdAt))
        .limit(limit)
        .offset((page - 1) * limit)
    : await db
        .select()
        .from(spins)
        .orderBy(desc(spins.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

  const breakdown = await db
    .select({
      sectorName: spins.sectorName,
      count: sql<number>`count(*)::int`,
    })
    .from(spins)
    .groupBy(spins.sectorName)
    .orderBy(sql`count(*) desc`);

  return NextResponse.json({
    items,
    breakdown,
    page,
    pages: Math.max(1, Math.ceil(count.value / limit)),
    total: count.value,
  });
}
