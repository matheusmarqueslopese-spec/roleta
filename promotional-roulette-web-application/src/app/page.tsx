import WheelExperience from "@/components/WheelExperience";
import { getWheelState, publicWheelState } from "@/lib/wheel";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const state = publicWheelState(await getWheelState());
  return <WheelExperience initialData={state} />;
}
