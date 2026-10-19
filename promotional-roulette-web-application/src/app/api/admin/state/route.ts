import { NextResponse } from "next/server";
import { getWheelState } from "@/lib/wheel";
import { requireAdmin, error } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return error("Não autorizado.", 401);
  const state = await getWheelState();
  return NextResponse.json({
    available: state.settings.available,
    configured: state.configured,
    sectors: state.sectors,
  }, { headers: { "Cache-Control": "no-store" } });
}
