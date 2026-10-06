import { type Strength, PASSWORD_MIN_LENGTH, passwordStrength } from '../lib/validation';

const labels: Record<Strength, string> = {
  'too-short': `At least ${PASSWORD_MIN_LENGTH} characters`,
  weak: 'Weak: add length or mix in numbers and symbols',
  fair: 'Fair: longer is stronger',
  strong: 'Strong',
};
const filled: Record<Strength, number> = { 'too-short': 0, weak: 1, fair: 2, strong: 3 };
const colour: Record<Strength, string> = {
  'too-short': 'bg-grid',
  weak: 'bg-down',
  fair: 'bg-unknown',
  strong: 'bg-up',
};

/** A three-segment hint under the password field. Advisory only; the server decides. */
export function PasswordStrength({ password }: { password: string }) {
  const strength = passwordStrength(password);
  return (
    <span className="flex items-center gap-2">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1 w-6 rounded-full ${i < filled[strength] ? colour[strength] : 'bg-grid'}`}
          />
        ))}
      </span>
      <span>{labels[strength]}</span>
    </span>
  );
}
