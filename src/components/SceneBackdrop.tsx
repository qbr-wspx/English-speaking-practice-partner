import type { Scenario } from "../types";

const scenes: Record<string, { name: string; hint: string; shape: string }> = {
  "cafe-ordering": { name: "CAFÉ", hint: "Warm afternoon", shape: "cafe" },
  "restaurant-dining": { name: "BISTRO", hint: "Dinner conversation", shape: "restaurant" },
  "hotel-checkin": { name: "LOBBY", hint: "A smooth arrival", shape: "hotel" },
  "airport-travel": { name: "DEPARTURES", hint: "On your way", shape: "airport" },
  "shopping-returns": { name: "MARKET", hint: "Find the right words", shape: "shopping" },
  "directions-transit": { name: "CITY WALK", hint: "Explore together", shape: "directions" },
  "job-interview": { name: "STUDIO", hint: "Speak with confidence", shape: "interview" },
  "daily-social": { name: "GARDEN", hint: "A friendly hello", shape: "social" },
};

export function SceneBackdrop({ scenario }: { scenario: Scenario }) {
  const scene = scenes[scenario.id] || { name: "YOUR STORY", hint: "A place to practise", shape: "custom" };
  return <div className={`scene-backdrop scene-backdrop--${scene.shape}`} aria-hidden="true">
    <div className="scene-orb" />
    <svg className="scene-illustration" viewBox="0 0 900 720" preserveAspectRatio="xMidYMid slice">
      <path className="scene-horizon" d="M0 492 Q210 468 430 494 T900 478 L900 720 H0Z" />
      <path className="scene-left" d="M0 168 Q69 135 113 180 L131 472 Q72 480 0 464Z" />
      <path className="scene-right" d="M900 148 Q818 120 792 202 L774 474 Q831 497 900 460Z" />
      <path className="scene-line" d="M19 472 Q212 448 413 476 M595 475 Q774 457 890 471" />
      {scene.shape === "cafe" || scene.shape === "restaurant" ? <>
        <path className="scene-line" d="M45 153 V340 M42 153 Q98 114 153 153 M735 150 Q788 113 848 153 V356" />
        <path className="scene-accent" d="M38 226 H166 V242 H38Z M756 222 H873 V238 H756Z" />
        <path className="scene-line" d="M54 420 Q108 390 155 420 M748 415 Q806 385 868 415" />
        <circle className="scene-light" cx="120" cy="170" r="20" /><circle className="scene-light" cx="811" cy="168" r="20" />
      </> : null}
      {scene.shape === "airport" || scene.shape === "hotel" ? <>
        <path className="scene-line" d="M17 192 H192 V380 H18 M710 180 H886 V382 H708 M47 205 V362 M78 205 V362 M820 198 V360" />
        <path className="scene-accent" d="M44 205 H166 V220 H44Z M741 196 H865 V211 H741Z" />
        <path className="scene-line" d="M35 437 H175 M725 434 H868" />
      </> : null}
      {scene.shape === "shopping" || scene.shape === "directions" ? <>
        <path className="scene-line" d="M30 206 H177 V413 H30Z M726 194 H875 V418 H726Z M30 286 H177 M726 283 H875" />
        <path className="scene-accent" d="M44 228 H162 V242 H44Z M739 217 H862 V231 H739Z" />
        <path className="scene-line" d="M54 432 H160 M745 436 H852" />
      </> : null}
      {scene.shape === "interview" || scene.shape === "custom" ? <>
        <path className="scene-line" d="M31 190 H192 V400 H31Z M716 190 H872 V400 H716Z M61 216 H161 M745 216 H845 M61 235 H161 M745 235 H845" />
        <path className="scene-accent" d="M45 340 H179 V353 H45Z M730 338 H861 V351 H730Z" />
      </> : null}
      {scene.shape === "social" ? <>
        <path className="scene-line" d="M55 458 Q27 317 68 228 M68 228 Q24 193 37 159 M68 228 Q110 183 129 148 M833 458 Q861 317 820 228 M820 228 Q865 193 850 159 M820 228 Q774 180 757 149" />
        <circle className="scene-accent" cx="70" cy="233" r="23" /><circle className="scene-accent" cx="816" cy="232" r="23" />
        <circle className="scene-light" cx="42" cy="175" r="13" /><circle className="scene-light" cx="845" cy="173" r="13" />
      </> : null}
    </svg>
    <div className="scene-sign"><strong>{scene.name}</strong><span>{scene.hint}</span></div>
  </div>;
}
