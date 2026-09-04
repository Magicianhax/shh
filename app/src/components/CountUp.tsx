import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

type Props = {
  value: number;
  /** Decimal places to show. */
  decimals?: number;
  durationSec?: number;
};

/**
 * A number that counts to its new value instead of jumping. Driven by Framer
 * Motion's `animate`, which ticks off rAF rather than a timer, and skipped
 * entirely when the viewer asked for reduced motion.
 */
export function CountUp({ value, decimals = 0, durationSec = 0.9 }: Props) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const controls = animate(shown, value, {
      duration: durationSec,
      ease: [0.2, 0.8, 0.3, 1],
      onUpdate: setShown,
    });
    return () => controls.stop();
    // `shown` is the animation's starting point, deliberately not a dependency:
    // re-running on every frame would restart the tween forever.
  }, [value, reduced, durationSec]);

  return (
    <>
      {shown.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </>
  );
}
