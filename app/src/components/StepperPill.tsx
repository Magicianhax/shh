import { MinusIcon, PlusIcon } from "./icons";

type Props = {
  label: string;
  /** Rendered value, already formatted. */
  text: string;
  unit: string;
  onStep: (direction: -1 | 1) => void;
  canDown: boolean;
  canUp: boolean;
  disabled?: boolean;
};

/** An inline value with a minus and a plus, for price and deadline. */
export function StepperPill({ label, text, unit, onStep, canDown, canUp, disabled }: Props) {
  return (
    <div className="spill" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={disabled || !canDown}
        aria-label={`Decrease ${label}`}
      >
        <MinusIcon size={12} />
      </button>
      <span className="spill-value">
        {text}
        <small>{unit}</small>
      </span>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={disabled || !canUp}
        aria-label={`Increase ${label}`}
      >
        <PlusIcon size={12} />
      </button>
    </div>
  );
}
