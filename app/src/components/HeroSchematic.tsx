import { motion, useReducedMotion } from "framer-motion";
import { EASE_OUT } from "../motion";

type NodeProps = {
  x: number;
  w: number;
  title: string;
  caption: string;
  accent?: boolean;
  delay: number;
  still: boolean;
};

const H = 78;
const Y = 66;

function Node({ x, w, title, caption, accent, delay, still }: NodeProps) {
  return (
    <motion.g
      initial={still ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: EASE_OUT }}
    >
      <rect
        x={x}
        y={Y}
        width={w}
        height={H}
        rx="14"
        fill="var(--panel)"
        stroke={accent ? "var(--accent-line)" : "var(--line-2)"}
      />
      <text
        x={x + w / 2}
        y={Y + 33}
        textAnchor="middle"
        fill={accent ? "var(--accent-t)" : "var(--ink)"}
        fontSize="15"
        fontWeight="600"
        letterSpacing="-0.2"
      >
        {title}
      </text>
      <text
        x={x + w / 2}
        y={Y + 55}
        textAnchor="middle"
        fill="var(--ink-3)"
        fontSize="13"
      >
        {caption}
      </text>
    </motion.g>
  );
}

function Wire({ from, to, delay, still }: { from: number; to: number; delay: number; still: boolean }) {
  const d = `M ${from} ${Y + H / 2} H ${to}`;
  return (
    <g>
      <path d={d} stroke="var(--line-2)" strokeWidth="1.5" fill="none" />
      <motion.path
        d={d}
        stroke="var(--accent-hi)"
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="6 10"
        initial={{ strokeDashoffset: 0, opacity: 0 }}
        animate={still ? { opacity: 0.9 } : { strokeDashoffset: [0, -32], opacity: 0.9 }}
        transition={
          still
            ? { duration: 0 }
            : {
                strokeDashoffset: { repeat: Infinity, duration: 1.1, ease: "linear", delay },
                opacity: { duration: 0.4, delay },
              }
        }
      />
      <motion.circle
        cx={to - 7}
        cy={Y + H / 2}
        r="3"
        fill="var(--accent-hi)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: delay + 0.2, duration: 0.3 }}
      />
    </g>
  );
}

/**
 * The mechanism in one picture: a prompt goes from the requester into the TEE
 * rollup, where it stays sealed, a provider answers inside the same enclave,
 * and the escrow settles on the base layer. The dashed wires flow by moving
 * `stroke-dashoffset`, and the enclave ring pulses by scaling, so nothing here
 * lays out on a frame.
 */
export function HeroSchematic() {
  const reduced = useReducedMotion();
  const still = Boolean(reduced);

  return (
    <div className="schematic">
      <svg viewBox="0 50 900 116" role="img" aria-label="Requester to TEE rollup to provider to settlement">
        <Node x={8} w={168} title="Requester" caption="writes a prompt" delay={0} still={still} />
        <Wire from={176} to={272} delay={0} still={still} />

        <motion.g
          initial={still ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease: EASE_OUT }}
        >
          {/* Pulsing ring around the enclave, scaled rather than resized. */}
          <motion.rect
            x={272}
            y={Y - 8}
            width={216}
            height={H + 16}
            rx="20"
            fill="none"
            stroke="var(--accent-hi)"
            initial={{ opacity: 0.5, scale: 1 }}
            animate={still ? { opacity: 0.25 } : { opacity: [0.5, 0, 0.5], scale: [1, 1.06, 1] }}
            transition={still ? { duration: 0 } : { repeat: Infinity, duration: 2.6, ease: EASE_OUT }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
          <rect
            x={272}
            y={Y}
            width={216}
            height={H}
            rx="14"
            fill="var(--panel-2)"
            stroke="var(--accent-line)"
          />
          <g transform={`translate(${292} ${Y + 20})`} stroke="var(--accent-t)" strokeWidth="1.6" fill="none" strokeLinecap="round">
            <rect x="1" y="7" width="13" height="9" rx="2.4" />
            <path d="M4.2 7V4.6a3.3 3.3 0 0 1 6.6 0V7" />
          </g>
          <text x={396} y={Y + 33} textAnchor="middle" fill="var(--accent-t)" fontSize="15" fontWeight="600">
            TEE rollup
          </text>
          <text x={380} y={Y + 55} textAnchor="middle" fill="var(--ink-3)" fontSize="13">
            prompt stays sealed
          </text>
        </motion.g>

        <Wire from={488} to={584} delay={0.18} still={still} />
        <Node x={584} w={148} title="Provider" caption="runs the model" delay={0.2} still={still} />
        <Wire from={732} to={780} delay={0.36} still={still} />
        <Node x={780} w={112} title="Settled" caption="escrow pays" delay={0.3} still={still} />
      </svg>
    </div>
  );
}
