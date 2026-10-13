// Shopping list stores. An item's `store` is optional ('' = any store). Stores are created the
// first time someone mentions one ("get eggs at Trader Joe's"), and common nicknames map to the
// same store so "TJ's", "Trader Joes" and "trader joe's" don't become three.
const ALIASES = {
  tj: 'Trader Joe’s', tjs: 'Trader Joe’s', traderjoe: 'Trader Joe’s', traderjoes: 'Trader Joe’s',
  costco: 'Costco', target: 'Target', safeway: 'Safeway', wholefoods: 'Whole Foods', wfm: 'Whole Foods',
  berkeleybowl: 'Berkeley Bowl', bowl: 'Berkeley Bowl', sprouts: 'Sprouts', lucky: 'Lucky', luckys: 'Lucky',
  monterey: 'Monterey Market', montereymarket: 'Monterey Market', ranch99: '99 Ranch', '99ranch': '99 Ranch',
  cvs: 'CVS', walgreens: 'Walgreens', amazon: 'Amazon', wholefoodsmarket: 'Whole Foods', andronicos: 'Andronico’s',
  homedepot: 'Home Depot', lowes: 'Lowe’s', ikea: 'IKEA', walmart: 'Walmart', grocery: '', groceries: '', grocerystore: '', supermarket: '', any: '', anystore: '', anywhere: ''
};
export const storeKey = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');

// Returns { id, name, stores } — stores is a new array when a store was added. id '' = any store.
export function resolveStore(stores, name) {
  stores = stores || [];
  const raw = String(name || '').trim().slice(0, 40);
  const k = storeKey(raw);
  if (!k || (k in ALIASES && ALIASES[k] === '')) return { id: '', name: '', stores };
  const canonical = ALIASES[k] || raw.replace(/\b\w/g, c => c.toUpperCase());
  const ck = storeKey(canonical);
  const hit = stores.find(s => s.id === raw || storeKey(s.name) === ck || storeKey(s.name) === k || storeKey(s.id) === ck);
  if (hit) return { id: hit.id, name: hit.name, stores };
  let id = ck.slice(0, 24) || 'store';
  while (stores.some(s => s.id === id)) id += '2';
  return { id, name: canonical, stores: stores.concat([{ id, name: canonical }]) };
}
export const storeName = (stores, id) => !id ? '' : ((stores || []).find(s => s.id === id) || {}).name || '';
