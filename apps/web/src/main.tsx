import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckoutSummary } from './features/checkout/CheckoutSummary.js';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <CheckoutSummary total="€42.00" onConfirm={() => alert('Confirmed')} />
    </StrictMode>,
  );
}
