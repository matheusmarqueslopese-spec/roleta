import { randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sectors, spins, wheelSettings } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { error } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { requestId?: string };
  try {
    body = await request.json();
  } catch {
    return error("Requisição inválida.");
  }
  if (!body.requestId || !/^[0-9a-f-]{36}$/i.test(body.requestId)) {
    return error("Identificador inválido.");
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute("select pg_advisory_xact_lock(7042026)");
      const duplicate = await tx
        .select()
        .from(spins)
        .where(eq(spins.requestId, body.requestId!))
        .limit(1);
      if (duplicate.length) {
        const [sec] = duplicate[0].sectorId
          ? await tx.select().from(sectors).where(eq(sectors.id, duplicate[0].sectorId)).limit(1)
          : [];
        return { spin: duplicate[0], description: sec?.description ?? "", duplicate: true };
      }
      const [settings] = await tx.select().from(wheelSettings).where(eq(wheelSettings.id, 1));
      const active = (await tx.select().from(sectors).orderBy(asc(sectors.position))).filter(
        (s) => s.active
      );
      if (!settings?.available) throw new Error("UNAVAILABLE");
      if (!active.length || active.some((s) => s.weight === null || Number(s.weight) <= 0)) {
        throw new Error("UNCONFIGURED");
      }
      const total = active.reduce((sum, s) => sum + Number(s.weight), 0);
      let ticket = (randomInt(0, 1_000_000_000) / 1_000_000_000) * total;
      const selected =
        active.find((s) => (ticket -= Number(s.weight)) < 0) ?? active[active.length - 1];
      const [spin] = await tx
        .insert(spins)
        .values({
          requestId: body.requestId!,
          sectorId: selected.id,
          sectorName: selected.name,
          sectorPosition: selected.position,
          selectedWeight: selected.weight!,
        })
        .returning();
      return { spin, description: selected.description ?? "", duplicate: false };
    });
    return NextResponse.json({
      id: result.spin.id,
      requestId: result.spin.requestId,
      sectorId: result.spin.sectorId,
      sectorName: result.spin.sectorName,
      sectorDescription: result.description,
      sectorPosition: result.spin.sectorPosition,
      createdAt: result.spin.createdAt,
      valid: true,
      duplicate: result.duplicate,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "UNAVAILABLE") {
      return error("A roleta ainda não está disponível.", 409);
    }
    if (cause instanceof Error && cause.message === "UNCONFIGURED") {
      return error("As probabilidades ainda não foram configuradas.", 409);
    }
    console.error(cause);
    return error("Não foi possível concluir o giro.", 500);
  }
}
