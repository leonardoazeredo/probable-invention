import { useId } from 'react';
import { Button, tokens } from '@pi/design-system';

export interface CheckoutSummaryProps {
  total: string;
  onConfirm: () => void;
}

/** A legitimate feature composition: it composes the canonical Button. */
export function CheckoutSummary({ total, onConfirm }: CheckoutSummaryProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} style={{ padding: tokens.space.lg }}>
      <h2 id={headingId}>Order summary</h2>
      <p>Total: {total}</p>
      <Button onClick={onConfirm}>Confirm order</Button>
    </section>
  );
}
