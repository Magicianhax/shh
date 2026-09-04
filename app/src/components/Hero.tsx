import { motion } from "framer-motion";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { HeroSchematic } from "./HeroSchematic";
import { BoltIcon, CoinIcon, LockIcon } from "./icons";
import { EASE_OUT, heroExit } from "../motion";

const PROPS = [
  {
    icon: <LockIcon size={18} />,
    title: "Prompts stay private",
    body: "The prompt is written into a delegated account inside the enclave, behind a read permission only you and the provider hold.",
  },
  {
    icon: <CoinIcon size={18} />,
    title: "Pay on approval",
    body: "The price sits in escrow from the moment you post. It moves to the provider when you approve, and back to you when you do not.",
  },
  {
    icon: <BoltIcon size={18} />,
    title: "Rollup speed",
    body: "Claiming, answering and approving happen on the ephemeral rollup, then commit back to devnet in one settled transaction.",
  },
];

/**
 * The landing state, shown until a wallet connects. It collapses upward on
 * connect, leaving the compact top bar behind.
 */
export function Hero() {
  const { setVisible } = useWalletModal();

  return (
    <motion.section
      className="hero"
      variants={heroExit}
      initial={false}
      animate="show"
      exit="exit"
    >
      <div className="hero-inner">
        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
        >
          Private inference, settled on Solana
        </motion.h1>

        <motion.p
          className="hero-lede"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: EASE_OUT }}
        >
          Post a prompt to a trusted enclave, let a provider answer it without anyone else
          reading it, and release the escrow only when the answer is good.
        </motion.p>

        <motion.div
          className="hero-cta"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease: EASE_OUT }}
        >
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setVisible(true)}>
            Connect wallet
          </button>
        </motion.div>

        <HeroSchematic />

        <div className="props">
          {PROPS.map((p, i) => (
            <motion.div
              key={p.title}
              className="prop"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 + i * 0.07, ease: EASE_OUT }}
            >
              {p.icon}
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
