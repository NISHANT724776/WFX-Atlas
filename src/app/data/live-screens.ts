// Workflow steps that can be done for real in Atlas (not only read about): the step's "Do it now" link opens the
// working screen. Only steps whose screen exists are listed; the rest stay documentation.
export interface LiveScreen { label: string; path: string; query?: Record<string, string>; note: string }

export const LIVE_STEPS: Record<string, LiveScreen> = {
  oc: { label: 'Create a Sales Order now', path: '/sales-order', query: { new: '1' }, note: 'Category and Buyer → the buyer’s screen → deliveries, articles, colour/size quantities → Confirm and approval. Saved in Atlas.' },
};

/** Transactions (theory pages) with a working screen. */
export const LIVE_TXNS: Record<string, LiveScreen> = {
  'buyer-po': { label: 'Open Sales Orders', path: '/sales-order', note: 'The working Sales Order list: Main OC wise or Style wise, Add New Order, approvals.' },
};
