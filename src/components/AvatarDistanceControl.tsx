export const avatarScaleMin = 0.72;
export const avatarScaleMax = 1.12;

export function AvatarDistanceControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <label className="avatar-distance-control">
    <span className="avatar-distance-heading">人物距离 <output>{value.toFixed(2)}×</output></span>
    <input type="range" min={avatarScaleMin} max={avatarScaleMax} step="0.02" value={value} onChange={event => onChange(Number(event.target.value))} aria-label="人物距离" />
    <span className="avatar-distance-ends"><span>远</span><span>近</span></span>
  </label>;
}
