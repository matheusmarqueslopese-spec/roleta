import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { admins } from "@/db/schema";
import { createAdminSession, verifyPassword } from "@/lib/auth";
import { error } from "@/lib/http";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { password?: string };
  const [admin] = await db.select().from(admins).limit(1);
  if (!admin || !body.password || !(await verifyPassword(body.password, admin.passwordHash))) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return error("Credenciais inválidas.", 401);
  }
  await createAdminSession(admin.id);
  return NextResponse.json({ ok: true });
}
