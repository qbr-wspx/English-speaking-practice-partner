import type { Scenario } from "../types";

const sceneIds = new Set([
  "cafe-ordering", "restaurant-dining", "hotel-checkin", "airport-travel",
  "shopping-returns", "directions-transit", "job-interview", "daily-social",
]);

export function SceneBackdrop({ scenario }: { scenario: Pick<Scenario, "id"> }) {
  const sceneId = sceneIds.has(scenario.id) ? scenario.id : null;
  return <div className={`scene-backdrop ${sceneId ? "" : "scene-backdrop--custom"}`} aria-hidden="true">
    {sceneId && <img src={new URL(`scenes/${sceneId}.png`, new URL("./", window.location.href)).href} alt="" />}
    <div className="scene-atmosphere" />
  </div>;
}
