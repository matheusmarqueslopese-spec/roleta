import { db } from "@/db";
import { sectors, wheelSettings } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export const INITIAL_SECTORS = [
  { name: "PRÊMIO ESPECIAL", color: "#0a2a63", description: "" },
  { name: "BÔNUS", color: "#0f63e8", description: "" },
  { name: "PRÊMIO ESPECIAL", color: "#dfe7f1", description: "" },
  { name: "TENTE DE NOVO", color: "#082254", description: "" },
  { name: "BRINDE SURPRESA", color: "#1479f2", description: "" },
  { name: "BÔNUS", color: "#0a2a63", description: "" },
  { name: "TENTE DE NOVO", color: "#0f63e8", description: "" },
  { name: "DESCONTO EXCLUSIVO", color: "#dfe7f1", description: "" },
] as const;

export async function ensureWheelData() {
  await db.insert(wheelSettings).values({ id: 1, available: false }).onConflictDoNothing();
  const existing = await db.select({ id: sectors.id }).from(sectors).limit(1);
  if (!existing.length) {
    await db.insert(sectors).values(
      INITIAL_SECTORS.map((item, position) => ({
        name: item.name,
        color: item.color,
        position,
        description: item.description,
        active: true,
        weight: null,
      }))
    );
  }
}

export async function getWheelState() {
  await ensureWheelData();
  const [settings] = await db.select().from(wheelSettings).where(eq(wheelSettings.id, 1));
  const items = await db.select().from(sectors).orderBy(asc(sectors.position));
  const active = items.filter((item) => item.active);
  const configured =
    active.length > 0 &&
    active.every((item) => item.weight !== null && Number(item.weight) > 0);
  return {
    settings,
    sectors: items,
    mode: settings.available && configured ? ("live" as const) : ("configuration" as const),
    configured,
  };
}

export type PublicSector = {
  id: string;
  name: string;
  description: string;
  color: string;
  position: number;
  active: boolean;
};

export function publicWheelState(state: Awaited<ReturnType<typeof getWheelState>>) {
  return {
    available: state.settings.available,
    configured: state.configured,
    mode: state.mode,
    sectors: state.sectors
      .filter((s) => s.active)
      .map(({ id, name, description, color, position, active }) => ({
        id,
        name,
        description,
        color,
        position,
        active,
      })),
  };
}
