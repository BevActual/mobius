/**
 * The Mobius mark: the whorl print chosen in the design (Logo studies). Four open rings around a solid core, each
 * broken at a different angle, the way a fingerprint's ridges never quite close. Drawn in the current colour; the
 * core takes `--mark-core` when set (the presence ring's heart), otherwise the same colour.
 *
 * Optical size: below 32px it drops to three rings and a heavier line so it stays open. `turning` sets the rings
 * moving, each at its own pace (the agent is starting or working); it stops for people who ask for less motion.
 */
const RINGS = [
  'M63.68 89.59A40 40 0 1 1 87.59 65.68',
  'M39.74 23.81A30 30 0 1 1 21.81 41.74',
  'M68.79 58.84A20 20 0 1 1 67.32 42',
  'M40.6 55.42A10 10 0 1 1 46.58 61.4',
];
const RINGS_SMALL = [
  'M63 87.71A38 38 0 1 1 85.71 65',
  'M41.45 28.51A25 25 0 1 1 26.51 43.45',
  'M61.28 56.1A12 12 0 1 1 60.39 46',
];

export function MobiusMark({ size = 24, turning = false, className, label }: { size?: number; turning?: boolean; className?: string; label?: string }) {
  const small = size < 32;
  const rings = small ? RINGS_SMALL : RINGS;
  return (
    <svg
      className={['mobius-mark', className].filter(Boolean).join(' ')}
      data-turning={turning || undefined}
      width={size}
      height={size}
      // Inline, so the app's general svg rule (18px, thin strokes) does not apply to the mark.
      style={{ width: size, height: size, strokeWidth: small ? 7.5 : 5 }}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {rings.map((d, i) => (
        // Outer ring is 1; inner rings turn faster.
        <path key={d} className="mark-ring" data-ring={i + 1} d={d} />
      ))}
      <circle className="mark-core" cx="50" cy="52" r={small ? 5 : 3.5} stroke="none" />
    </svg>
  );
}
