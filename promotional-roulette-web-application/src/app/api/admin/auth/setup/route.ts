import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { admins } from "@/db/schema";
import { createAdminSession, hashPassword } from "@/lib/auth";
import { error } from "@/lib/http";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { password?: string };
  if (!body.password || body.password.length < 10) return error("Use uma senha com pelo menos 10 caracteres.");
  const result = await db.transaction(async (tx) => {
    await tx.execute("select pg_advisory_xact_lock(7042027)");
    const [existing] = await tx.select({ id: admins.id }).from(admins).limit(1);
    if (existing) return null;
    const [admin] = await tx.insert(admins).values({ passwordHash: await hashPassword(body.password!) }).returning({ id: admins.id });
    return admin;
  });
  if (!result) return error("O acesso administrativo já foi configurado.", 409);
  await createAdminSession(result.id);
  return NextResponse.json({ ok: true });
}
