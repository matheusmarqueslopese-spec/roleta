import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sectors, wheelSettings } from "@/db/schema";
import { eq, inArray, notInArray } from "drizzle-orm";
import { error, isHexColor, requireAdmin } from "@/lib/http";
import { INITIAL_SECTORS } from "@/lib/wheel";

type SectorInput = {
  id?: string;
  name: string;
  description: string;
  color: string;
  position: number;
  weight: string | number | null;
  active: boolean;
};

export async function PUT(request: NextRequest) {
  if (!(await requireAdmin())) return error("Não autorizado.", 401);
  const body = (await request.json().catch(() => ({}))) as { sectors?: SectorInput[] };
  if (!Array.isArray(body.sectors) || body.sectors.length < 2 || body.sectors.length > 24) {
    return error("A roleta deve ter entre 2 e 24 setores.");
  }
  const positions = new Set<number>();
  for (const item of body.sectors) {
    const weight = item.weight === null || item.weight === "" ? null : Number(item.weight);
    if (!item.name?.trim() || item.name.trim().length > 60) {
      return error("Revise o nome dos setores (1 a 60 caracteres).");
    }
    if ((item.description ?? "").length > 240 || !isHexColor(item.color)) {
      return error("Descrição ou cor hexadecimal inválida.");
    }
    if (!Number.isInteger(item.position) || positions.has(item.position)) {
      return error("A ordem dos setores deve ser única.");
    }
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight > 1_000_000)) {
      return error("Os pesos devem ser números positivos.");
    }
    positions.add(item.position);
  }

  const activeItems = body.sectors.filter((item) => Boolean(item.active));
  const fullyConfigured =
    activeItems.length > 0 &&
    activeItems.every(
      (item) => item.weight !== null && item.weight !== "" && Number(item.weight) > 0
    );

  await db.transaction(async (tx) => {
    const existingIds = body.sectors!
      .map((s) => s.id)
      .filter((id): id is string => Boolean(id && !id.startsWith("new-")));

    if (existingIds.length > 0) {
      await tx.delete(sectors).where(notInArray(sectors.id, existingIds));
    } else {
      await tx.delete(sectors);
    }

    for (const item of body.sectors!) {
      const weight =
        item.weight === null || item.weight === "" ? null : String(Number(item.weight));
      const payload = {
        name: item.name.trim(),
        description: (item.description ?? "").trim(),
        color: item.color,
        position: item.position,
        weight,
        active: Boolean(item.active),
        updatedAt: new Date(),
      };
      if (item.id && !item.id.startsWith("new-")) {
        await tx.update(sectors).set(payload).where(eq(sectors.id, item.id));
      } else {
        await tx.insert(sectors).values(payload);
      }
    }

    if (!fullyConfigured) {
      await tx
        .update(wheelSettings)
        .set({ available: false, updatedAt: new Date() })
        .where(eq(wheelSettings.id, 1));
    }
  });

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return error("Não autorizado.", 401);
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "reset_defaults") return error("Ação inválida.");

  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: sectors.id }).from(sectors);
    if (existing.length) {
      await tx.delete(sectors).where(
        inArray(
          sectors.id,
          existing.map((e) => e.id)
        )
      );
    }
    await tx.insert(sectors).values(
      INITIAL_SECTORS.map((item, position) => ({
        name: item.name,
        color: item.color,
        position,
        description: item.description,
        active: true,
        weight: null,
      }))
    );
    await tx
      .update(wheelSettings)
      .set({ available: false, updatedAt: new Date() })
      .where(eq(wheelSettings.id, 1));
  });

  return NextResponse.json({ ok: true });
}
