import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HeroActions } from './features/hero/HeroActions.js';
import { CheckoutSummary } from './features/checkout/CheckoutSummary.js';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <HeroActions
        title="Title"
        subtitle="Subtitle"
        secondaryLabel="Button"
        primaryLabel="Button"
        onSecondary={() => alert('Secondary')}
        onPrimary={() => alert('Primary')}
      />
      <CheckoutSummary total="€42.00" onConfirm={() => alert('Confirmed')} />
    </StrictMode>,
  );
}
