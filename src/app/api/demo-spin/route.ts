import { NextRequest, NextResponse } from "next/server";
import { getWheelState } from "@/lib/wheel";
import { error } from "@/lib/http";

export async function POST(request: NextRequest) {
  let body: { cursor?: number } = {};
  try {
    body = await request.json();
  } catch {
    /* deterministic demo needs no data */
  }
  const state = await getWheelState();
  const active = state.sectors.filter((s) => s.active);
  if (!active.length) return error("Nenhum setor ativo para demonstração.", 409);
  const cursor = Number.isInteger(body.cursor) ? Math.abs(Number(body.cursor)) : 0;
  const selected = active[cursor % active.length];
  return NextResponse.json({
    sectorId: selected.id,
    sectorName: selected.name,
    sectorDescription: selected.description ?? "",
    sectorPosition: selected.position,
    createdAt: new Date().toISOString(),
    valid: false,
    demo: true,
  });
}
