import { NextResponse } from "next/server";
import { db } from "@/db";
import { admins } from "@/db/schema";
import { getAdmin } from "@/lib/auth";

export async function GET() {
  const [existing] = await db.select({ id: admins.id }).from(admins).limit(1);
  return NextResponse.json({ setupRequired: !existing, authenticated: Boolean(await getAdmin()) });
}
