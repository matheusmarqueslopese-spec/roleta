import { NextResponse } from "next/server";
import { getAdmin } from "./auth";

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireAdmin() {
  const admin = await getAdmin();
  return admin;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}
