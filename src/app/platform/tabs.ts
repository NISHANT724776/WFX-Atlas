/** The knowledge platform's pages, shown in the top bar's "Knowledge" menu (Assistant first: it is the same grounded assistant). */
export const KB_TABS: { path: string; label: string; role?: 'editor' | 'admin' }[] = [
  { path: '/assistant', label: 'Assistant' }, { path: '/dashboard', label: 'Dashboard' }, { path: '/library', label: 'Library' },
  { path: '/rulebook', label: 'Rulebook' }, { path: '/question-mapping', label: 'Question mapping' }, { path: '/transactions', label: 'Transactions' }, { path: '/calc-lab', label: 'Calculation Lab' },
  { path: '/ba-copilot', label: 'BA Copilot' }, { path: '/profile', label: 'Profile' }, { path: '/admin', label: 'Admin', role: 'admin' },
];
