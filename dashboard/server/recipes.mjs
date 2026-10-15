// Recipes: saved by texting the iMessage agent a recipe or a photo of one, or added on the phone.
// The recipes live in state.recipes (saved with the rest of the house data, in the daily backups,
// synced to every screen). The photo a recipe came from is kept in data/recipes/<id>.jpg and served
// at /api/home/recipes/photo/<id>.jpg.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const mins = v => { const n = Math.round(+v); return n > 0 && n < 10000 ? n : null; };

export function createRecipes({ dataDir, getState, commit, shoppingAdd, log }) {
  const DIR = path.join(dataDir, 'recipes');
  fs.mkdirSync(DIR, { recursive: true });
  const newId = () => 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const list = () => getState().recipes || [];
  const photoFile = rid => path.join(DIR, String(rid).replace(/[^a-z0-9]/gi, '') + '.jpg');

  function find(q) {
    q = String(q || '').toLowerCase().trim(); if (!q) return null;
    const L = list();
    return L.find(r => r.id === q) || L.find(r => r.title.toLowerCase() === q) ||
      L.find(r => r.title.toLowerCase().includes(q) || q.includes(r.title.toLowerCase()));
  }
  // Only the fields given are returned, so the same cleaner works for add and update
  function clean(a) {
    const out = {};
    if (a.title != null) out.title = str(a.title, 120);
    if (a.servings != null) out.servings = str(a.servings, 40);
    if (a.prep_minutes != null) out.prepMin = mins(a.prep_minutes);
    if (a.cook_minutes != null) out.cookMin = mins(a.cook_minutes);
    if (a.ingredients != null) out.ingredients = (Array.isArray(a.ingredients) ? a.ingredients : []).slice(0, 80).map(i => typeof i === 'string'
      ? { item: str(i, 120), amount: '' }
      : { item: str(i.item || i.name, 120), amount: str(i.amount, 60), note: str(i.note, 120) || undefined, section: str(i.section, 60) || undefined }).filter(i => i.item);
    if (a.steps != null) out.steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, 60).map(s => String(s || '').trim().slice(0, 1200)).filter(Boolean);
    if (a.tags != null) out.tags = (Array.isArray(a.tags) ? a.tags : []).slice(0, 10).map(t => str(t, 24).toLowerCase()).filter(Boolean);
    if (a.source != null) out.source = str(a.source, 200);
    if (a.notes != null) out.notes = String(a.notes || '').trim().slice(0, 1500);
    return out;
  }
  async function savePhoto(rid, img) {
    if (!img || !img.data) return null;
    await fsp.writeFile(photoFile(rid), Buffer.from(img.data, 'base64'));
    return '/api/home/recipes/photo/' + rid + '.jpg?v=' + Date.now().toString(36);
  }
  function brief(r) {
    const t = (r.prepMin || 0) + (r.cookMin || 0);
    return { title: r.title, tags: r.tags, totalMinutes: t || undefined, servings: r.servings || undefined, ingredients: (r.ingredients || []).length };
  }

  const ING = { type: 'object', properties: {
    item: { type: 'string', description: 'The ingredient as a shopper would look for it, e.g. "chicken thighs", "yellow onion"' },
    amount: { type: 'string', description: 'Quantity and unit exactly as written, e.g. "2 lb", "1 1/2 cups", "to taste"' },
    note: { type: 'string', description: 'Prep or detail, e.g. "boneless, skinless", "finely diced"' },
    section: { type: 'string', description: 'Sub-list heading if the recipe has one, e.g. "Marinade", "Sauce"' } }, required: ['item'] };
  const FIELDS = {
    title: { type: 'string' },
    servings: { type: 'string', description: 'e.g. "4", "6-8", "1 loaf"' },
    prep_minutes: { type: 'number' }, cook_minutes: { type: 'number' },
    ingredients: { type: 'array', items: ING },
    steps: { type: 'array', items: { type: 'string' }, description: 'One instruction per step, in order, without numbering' },
    tags: { type: 'array', items: { type: 'string' }, description: 'A few short tags: meal (dinner, breakfast, dessert), cuisine, main ingredient, e.g. "vegetarian", "quick"' },
    source: { type: 'string', description: 'Where it came from: cookbook and page, website, or a person ("Georgia’s mom")' },
    notes: { type: 'string', description: 'Tips, swaps or anything else on the recipe' }
  };
  const tools = [
    { name: 'recipe_add', description: 'Save a recipe to the dashboard’s Recipes tab. Use this whenever someone texts a recipe, a link’s worth of recipe text, or a photo of one (cookbook page, screenshot, handwritten card) and wants it kept. Copy it faithfully: keep every ingredient with its exact amount and every step in order; never invent or guess quantities (leave amount empty and say what you couldn’t read). The photo sent with the message is kept with the recipe automatically.',
      input_schema: { type: 'object', properties: Object.assign({}, FIELDS, { keep_photo: { type: 'boolean', description: 'Keep the photo they sent with the recipe (default true)' } }), required: ['title', 'ingredients', 'steps'] } },
    { name: 'recipe_list', description: 'List saved recipes, optionally filtered by words in the title, tags or ingredients (e.g. "chicken", "dessert").', input_schema: { type: 'object', properties: { query: { type: 'string' } } } },
    { name: 'recipe_get', description: 'The full recipe (ingredients and steps) by title.', input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
    { name: 'recipe_update', description: 'Change a saved recipe. Give the title to find it and only the fields to change (a list given replaces that whole list). Use new_title to rename. Set replace_photo to keep the photo sent with this message instead.',
      input_schema: { type: 'object', properties: Object.assign({}, FIELDS, { new_title: { type: 'string' }, replace_photo: { type: 'boolean' } }), required: ['title'] } },
    { name: 'recipe_remove', description: 'Delete a saved recipe (and its photo).', input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
    { name: 'recipe_to_shopping', description: 'Put a recipe’s ingredients on the shopping list. Leave out pantry basics they probably have (salt, pepper, oil, water) unless asked, and anything they say they already have.',
      input_schema: { type: 'object', properties: { title: { type: 'string' }, skip: { type: 'array', items: { type: 'string' }, description: 'Ingredients to leave off' }, store: { type: 'string', description: 'Only if they say where to buy them' } }, required: ['title'] } }
  ];

  async function shop(r, opts, who) {
    opts = opts || {};
    const skip = (opts.skip || []).map(s => String(s).toLowerCase());
    const only = opts.items ? opts.items.map(s => String(s).toLowerCase()) : null;
    const items = (r.ingredients || []).filter(i => {
      const n = i.item.toLowerCase();
      if (only) return only.includes(n);
      return !skip.some(s => n.includes(s) || s.includes(n));
    }).map(i => ({ name: i.item, note: [i.amount, i.note].filter(Boolean).join(', ').slice(0, 80), store: opts.store || undefined }));
    if (!items.length) return { added: [], note: 'Nothing to add' };
    const res = await shoppingAdd(items, who);
    return Object.assign({ recipe: r.title }, res);
  }

  async function runTool(name, a, c) {
    c = c || {};
    switch (name) {
      case 'recipe_add': {
        const r = clean(a);
        if (!r.title) return { error: 'A recipe needs a title' };
        if (list().some(x => x.title.toLowerCase() === r.title.toLowerCase())) return { error: 'There is already a recipe called "' + r.title + '". Use recipe_update to change it, or pick a different title.' };
        const imgs = c.images || [];
        Object.assign(r, { id: newId(), by: c.who || null, at: Date.now(), via: c.channel === 'imessage' ? (imgs.length ? 'photo' : 'text') : (c.channel || 'agent') });
        r.ingredients = r.ingredients || []; r.steps = r.steps || []; r.tags = r.tags || [];
        if (imgs.length && a.keep_photo !== false) {
          try { r.photo = await savePhoto(r.id, imgs[0]); } catch (e) { log('recipes: photo', e.message); }
        }
        commit({ recipes: [r].concat(list()) }, 'assistant');
        return { saved: r.title, ingredients: r.ingredients.length, steps: r.steps.length, photoKept: !!r.photo };
      }
      case 'recipe_list': {
        const q = String(a.query || '').toLowerCase().trim();
        const L = list().filter(r => !q || r.title.toLowerCase().includes(q) || (r.tags || []).some(t => t.includes(q)) || (r.ingredients || []).some(i => i.item.toLowerCase().includes(q)));
        return { count: L.length, recipes: L.slice(0, 50).map(brief) };
      }
      case 'recipe_get': {
        const r = find(a.title); if (!r) return { error: 'No recipe like that', recipes: list().slice(0, 30).map(x => x.title) };
        return { title: r.title, servings: r.servings, prepMinutes: r.prepMin, cookMinutes: r.cookMin, ingredients: r.ingredients, steps: r.steps, tags: r.tags, source: r.source, notes: r.notes, addedBy: r.by, added: new Date(r.at).toDateString() };
      }
      case 'recipe_update': {
        const r = find(a.title); if (!r) return { error: 'No recipe like that', recipes: list().slice(0, 30).map(x => x.title) };
        const ch = clean(Object.assign({}, a, { title: a.new_title }));
        if (a.new_title == null) delete ch.title;
        const next = Object.assign({}, r, ch, { edited: Date.now() });
        if (a.replace_photo && c.images && c.images.length) next.photo = await savePhoto(r.id, c.images[0]);
        commit({ recipes: list().map(x => x.id === r.id ? next : x) }, 'assistant');
        return { updated: next.title, changed: Object.keys(ch).concat(a.replace_photo ? ['photo'] : []) };
      }
      case 'recipe_remove': {
        const r = find(a.title); if (!r) return { error: 'No recipe like that' };
        commit({ recipes: list().filter(x => x.id !== r.id) }, 'assistant');
        fsp.rm(photoFile(r.id), { force: true }).catch(() => {});
        return { removed: r.title };
      }
      case 'recipe_to_shopping': {
        const r = find(a.title); if (!r) return { error: 'No recipe like that' };
        return shop(r, { skip: a.skip, store: a.store }, c.who);
      }
    }
    return { error: 'Unknown tool' };
  }

  // Photos whose recipe was deleted on a screen are cleared out a minute after start-up
  setTimeout(async () => {
    try {
      const keep = new Set(list().map(r => r.id + '.jpg'));
      for (const f of await fsp.readdir(DIR)) if (/\.jpg$/.test(f) && !keep.has(f)) await fsp.rm(path.join(DIR, f), { force: true });
    } catch (e) { log('recipes: sweep', e.message); }
  }, 60000);

  return {
    group: { group: 'Recipes', tools, run: runTool },
    toolNames: tools.map(t => t.name),
    photoFile,
    // "Add to shopping list" from the frame or the phone: items = the ingredient names they ticked
    shopFromScreen: (rid, items, who) => { const r = list().find(x => x.id === rid); if (!r) throw Object.assign(new Error('That recipe is gone'), { status: 404 }); return shop(r, { items }, who); }
  };
}
