/** Two approved mouth drawings, with hysteresis to avoid chatter at the threshold. */
export function mouthIsOpen(energy: number, speaking: boolean, wasOpen: boolean): boolean {
  if (!speaking || !Number.isFinite(energy) || energy <= 0) return false;
  return energy >= (wasOpen ? 0.065 : 0.12);
}
