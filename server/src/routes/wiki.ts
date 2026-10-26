import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAdmin, requireUser, type AppEnv } from '../auth.ts';
import { all, now, one, run } from '../db.ts';
import { slugify } from '../slug.ts';

export const wikiRoutes = new Hono<AppEnv>();

const PAGE_SQL = `SELECT p.id, p.slug, p.title, p.body, p.created_at, p.updated_at, u.username AS updated_by
  FROM wiki_pages p LEFT JOIN users u ON u.id = p.updated_by`;

wikiRoutes.get('/', requireUser, (c) => {
  const q = c.req.query('q')?.trim();
  const rows = q
    ? all(
        `SELECT slug, title, updated_at, substr(body, 1, 200) AS excerpt FROM wiki_pages
         WHERE title LIKE ? OR body LIKE ? ORDER BY (title LIKE ?) DESC, title COLLATE NOCASE`,
        `%${q}%`, `%${q}%`, `%${q}%`,
      )
    : all('SELECT slug, title, updated_at, substr(body, 1, 200) AS excerpt FROM wiki_pages ORDER BY title COLLATE NOCASE');
  return c.json(rows);
});

wikiRoutes.get('/:slug', requireUser, (c) => {
  const page = one(`${PAGE_SQL} WHERE p.slug = ?`, c.req.param('slug'));
  if (!page) throw new HTTPException(404, { message: 'No page with that name yet' });
  return c.json(page);
});

function validate(b: { title?: string; body?: string }) {
  const title = b.title?.trim() ?? '';
  if (!title) throw new HTTPException(400, { message: 'Give the page a title' });
  if (title.length > 120) throw new HTTPException(400, { message: 'Titles can be 120 characters at most' });
  if ((b.body?.length ?? 0) > 200_000) throw new HTTPException(400, { message: 'That page is too long' });
  return { title, body: b.body ?? '' };
}

function uniqueSlug(title: string, exceptId?: number) {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; one('SELECT id FROM wiki_pages WHERE slug = ? AND id IS NOT ?', slug, exceptId ?? null); i++) slug = `${base}-${i}`;
  return slug;
}

wikiRoutes.post('/', requireAdmin, async (c) => {
  const { title, body } = validate(await c.req.json());
  const slug = uniqueSlug(title);
  run('INSERT INTO wiki_pages (slug, title, body, updated_by) VALUES (?, ?, ?, ?)', slug, title, body, c.get('user').id);
  return c.json(one(`${PAGE_SQL} WHERE p.slug = ?`, slug), 201);
});

wikiRoutes.put('/:slug', requireAdmin, async (c) => {
  const page = one<{ id: number; title: string; slug: string }>('SELECT id, title, slug FROM wiki_pages WHERE slug = ?', c.req.param('slug'));
  if (!page) throw new HTTPException(404, { message: 'Page not found' });
  const { title, body } = validate(await c.req.json());
  // Renaming changes the address; [[links]] by title still find it.
  const slug = title === page.title ? page.slug : uniqueSlug(title, page.id);
  run('UPDATE wiki_pages SET slug = ?, title = ?, body = ?, updated_by = ?, updated_at = ? WHERE id = ?', slug, title, body, c.get('user').id, now(), page.id);
  return c.json(one(`${PAGE_SQL} WHERE p.id = ?`, page.id));
});

wikiRoutes.delete('/:slug', requireAdmin, (c) => {
  run('DELETE FROM wiki_pages WHERE slug = ?', c.req.param('slug'));
  return c.json({ ok: true });
});
