import { NextResponse } from "next/server";
import { getWheelState, publicWheelState } from "@/lib/wheel";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(publicWheelState(await getWheelState()), {
    headers: { "Cache-Control": "no-store" },
  });
}
