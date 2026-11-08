/**
 * The Mobius mark: a whorl print. Open rings around a core, each ring's opening turned a little further than the one
 * inside it, so the rings read as a spiral. Drawn in the current colour.
 *
 * `turning` sets the rings moving, each at its own speed (the agent is starting or working); it stops for people who
 * ask for less motion. Below 20px the mark has two rings, since three run together that small.
 */
export function MobiusMark({ size = 24, turning = false, className, label }: { size?: number; turning?: boolean; className?: string; label?: string }) {
  const small = size < 20;
  return (
    <svg
      className={['mobius-mark', className].filter(Boolean).join(' ')}
      data-turning={turning || undefined}
      width={size}
      height={size}
      // Inline, so the app's general svg rule (18px, thin strokes) does not apply to the mark.
      style={{ width: size, height: size, strokeWidth: small ? 6 : 4.5 }}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {small ? (
        <>
          <path className="mark-ring" data-ring="1" d="M39.00 19.88A14 14 0 1 1 22.10 22.10" />
          <path className="mark-ring" data-ring="3" d="M55.56 42.99A26 26 0 1 1 55.56 21.01" />
          <circle cx="32" cy="32" r="5.5" fill="currentColor" stroke="none" />
        </>
      ) : (
        <>
          <path className="mark-ring" data-ring="1" d="M37.50 22.47A11 11 0 1 1 24.22 24.22" />
          <path className="mark-ring" data-ring="2" d="M49.38 25.67A18.5 18.5 0 1 1 35.21 13.78" />
          <path className="mark-ring" data-ring="3" d="M55.56 42.99A26 26 0 1 1 55.56 21.01" />
          <circle cx="32" cy="32" r="4.2" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}
