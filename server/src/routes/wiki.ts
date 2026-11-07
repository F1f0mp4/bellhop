import fs from 'node:fs';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { requireAdmin, requireUser, type AppEnv } from '../auth.ts';
import { all, now, one, run } from '../db.ts';
import { slugify } from '../slug.ts';
import { imagePath, MAX_IMAGE_BYTES, saveImage, sniffImage } from '../wikiImages.ts';

export const wikiRoutes = new Hono<AppEnv>();

// Images for pages. The body is the raw file; its first bytes decide the format.
wikiRoutes.post(
  '/images',
  requireAdmin,
  bodyLimit({
    maxSize: MAX_IMAGE_BYTES,
    onError: () => {
      throw new HTTPException(413, { message: `Images can be ${MAX_IMAGE_BYTES / 1048576} MB at most` });
    },
  }),
  async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw new HTTPException(400, { message: 'That image is empty' });
    const ext = sniffImage(bytes);
    if (!ext) throw new HTTPException(415, { message: 'Use a PNG, JPEG, GIF or WebP image' });
    return c.json({ url: `/api/wiki/images/${saveImage(bytes, ext)}` }, 201);
  },
);

wikiRoutes.get('/images/:name', requireUser, (c) => {
  const found = imagePath(c.req.param('name'));
  if (!found) throw new HTTPException(404, { message: 'Image not found' });
  return c.body(fs.readFileSync(found.file), 200, {
    'content-type': found.type,
    // Names come from the contents, so a name never points at a different picture.
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
});

const PAGE_SQL = `SELECT p.id, p.slug, p.title, p.body, p.category, p.created_at, p.updated_at,
    c.username AS created_by, u.username AS updated_by
  FROM wiki_pages p LEFT JOIN users c ON c.id = p.created_by LEFT JOIN users u ON u.id = p.updated_by`;

const LIST_SQL = `SELECT p.slug, p.title, p.category, p.updated_at, substr(p.body, 1, 200) AS excerpt, c.username AS created_by
  FROM wiki_pages p LEFT JOIN users c ON c.id = p.created_by`;

wikiRoutes.get('/', requireUser, (c) => {
  const q = c.req.query('q')?.trim();
  const rows = q
    ? all(
        `${LIST_SQL} WHERE p.title LIKE ? OR p.body LIKE ? OR p.category LIKE ?
         ORDER BY (p.title LIKE ?) DESC, p.title COLLATE NOCASE`,
        `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`,
      )
    : all(`${LIST_SQL} ORDER BY p.title COLLATE NOCASE`);
  return c.json(rows);
});

wikiRoutes.get('/:slug', requireUser, (c) => {
  const page = one(`${PAGE_SQL} WHERE p.slug = ?`, c.req.param('slug'));
  if (!page) throw new HTTPException(404, { message: 'No page with that name yet' });
  return c.json(page);
});

function validate(b: { title?: string; body?: string; category?: string }) {
  const title = b.title?.trim() ?? '';
  if (!title) throw new HTTPException(400, { message: 'Give the page a title' });
  if (title.length > 120) throw new HTTPException(400, { message: 'Titles can be 120 characters at most' });
  if ((b.body?.length ?? 0) > 200_000) throw new HTTPException(400, { message: 'That page is too long' });
  return { title, body: b.body ?? '', category: category(b.category) };
}

/** Tidies a category name, reusing the spelling of an existing one so "minecraft" joins "Minecraft". */
function category(raw: unknown) {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (name.length > 40) throw new HTTPException(400, { message: 'Category names can be 40 characters at most' });
  if (!name) return '';
  return one<{ category: string }>('SELECT category FROM wiki_pages WHERE category = ? COLLATE NOCASE LIMIT 1', name)?.category ?? name;
}

function uniqueSlug(title: string, exceptId?: number) {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; one('SELECT id FROM wiki_pages WHERE slug = ? AND id IS NOT ?', slug, exceptId ?? null); i++) slug = `${base}-${i}`;
  return slug;
}

wikiRoutes.post('/', requireAdmin, async (c) => {
  const { title, body, category } = validate(await c.req.json());
  const slug = uniqueSlug(title);
  const me = c.get('user').id;
  run('INSERT INTO wiki_pages (slug, title, body, category, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)', slug, title, body, category, me, me);
  return c.json(one(`${PAGE_SQL} WHERE p.slug = ?`, slug), 201);
});

wikiRoutes.put('/:slug', requireAdmin, async (c) => {
  const page = one<{ id: number; title: string; slug: string }>('SELECT id, title, slug FROM wiki_pages WHERE slug = ?', c.req.param('slug'));
  if (!page) throw new HTTPException(404, { message: 'Page not found' });
  const { title, body, category } = validate(await c.req.json());
  // Renaming changes the address; [[links]] by title still find it.
  const slug = title === page.title ? page.slug : uniqueSlug(title, page.id);
  run(
    'UPDATE wiki_pages SET slug = ?, title = ?, body = ?, category = ?, updated_by = ?, updated_at = ? WHERE id = ?',
    slug, title, body, category, c.get('user').id, now(), page.id,
  );
  return c.json(one(`${PAGE_SQL} WHERE p.id = ?`, page.id));
});

wikiRoutes.delete('/:slug', requireAdmin, (c) => {
  run('DELETE FROM wiki_pages WHERE slug = ?', c.req.param('slug'));
  return c.json({ ok: true });
});
