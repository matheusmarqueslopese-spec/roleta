import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { wheelSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { error, requireAdmin } from "@/lib/http";
import { getWheelState } from "@/lib/wheel";

export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) return error("Não autorizado.", 401);
  const body = await request.json().catch(() => ({})) as { available?: boolean };
  if (typeof body.available !== "boolean") return error("Estado inválido.");
  const state = await getWheelState();
  if (body.available && !state.configured) return error("Configure um peso positivo para cada setor ativo antes de publicar.", 409);
  await db.update(wheelSettings).set({ available: body.available, updatedAt: new Date() }).where(eq(wheelSettings.id, 1));
  return NextResponse.json({ ok: true, available: body.available });
}
