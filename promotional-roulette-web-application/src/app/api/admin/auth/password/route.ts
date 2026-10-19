import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { error, requireAdmin } from "@/lib/http";

export async function PUT(request: NextRequest) {
  const sessionAdmin = await requireAdmin();
  if (!sessionAdmin) return error("Não autorizado.", 401);

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!body.currentPassword || !body.newPassword) {
    return error("Informe a senha atual e a nova senha.");
  }
  if (body.newPassword.length < 10) {
    return error("A nova senha deve ter pelo menos 10 caracteres.");
  }

  const [admin] = await db
    .select()
    .from(admins)
    .where(eq(admins.id, sessionAdmin.id))
    .limit(1);
  if (!admin || !(await verifyPassword(body.currentPassword, admin.passwordHash))) {
    return error("A senha atual está incorreta.", 401);
  }

  const newHash = await hashPassword(body.newPassword);
  await db.update(admins).set({ passwordHash: newHash }).where(eq(admins.id, admin.id));

  return NextResponse.json({ ok: true });
}
