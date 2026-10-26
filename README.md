# Bellhop

A small request desk for your homelab. People in your household sign in and ring the bell when
something's broken, when they have an idea, or when they want a movie, series or album. You get a
board to work through those requests, and a drag-and-drop screen that puts media files into the
right Jellyfin folders, so you never have to SSH into the disk again.

- **For everyone:** send a request, search movies/shows/albums with posters, see status and replies.
- **For you:** kanban board, replies, user accounts, and a media drop-off that uploads from your
  browser or sorts files already sitting in your downloads folder.
- **Side panel:** one place with every service (Jellyfin, Crafty, Minecraft servers…) and whether
  it's up, plus a small Markdown wiki.
- **Storage:** one SQLite file (`data/bellhop.db`). No database server. Back it up by copying it.

## Run it

1. Copy the example settings and set an admin password:

   ```bash
   cp .env.example .env
   ```

2. In `docker-compose.yml`, point the volumes at your folders and set `PUID`/`PGID` to the user that
   owns your media (`id` on the host prints them):

   ```yaml
   - /mnt/media:/media         # contains Movies/, Shows/, Music/
   - /mnt/downloads:/incoming  # optional
   ```

3. Start it:

   ```bash
   docker compose up -d --build
   ```

Open `http://<server>:8080`, sign in with the admin from `.env`, then:

- **Users:** add an account for each person.
- **Settings:** add your Jellyfin URL and API key (Jellyfin → Dashboard → API Keys) so imports trigger
  a rescan. Add a free [TMDB](https://www.themoviedb.org/settings/api) key for movie/show posters and
  search. Music search uses MusicBrainz and needs no key.

If you leave `ADMIN_PASSWORD` empty, a random one is printed in the logs on first start
(`docker compose logs bellhop`).

## Side panel and wiki

The grid button in the top-left opens a panel with everything in the homelab, grouped however you
like (Media, Minecraft, Network…). On a wide screen, pin it to keep it open as a sidebar.

- **Websites** (Jellyfin, Crafty, your router) open in a new tab, with a green or red dot showing
  whether they answer. Anything that responds below HTTP 500 counts as up, so login pages are fine,
  and self-signed certificates are accepted.
- **Minecraft servers** show players online and the version, read straight from the server the way
  the multiplayer screen does, so it works for every Crafty server without an API key. Clicking one
  copies the address. SRV records (`_minecraft._tcp`) are followed.
- If the public address goes through something Bellhop can't reach (Cloudflare Access, a VPN), set
  **Check a different address** to the LAN address.

Status is checked every minute. Manage links under **Manage links** at the bottom of the panel.

The **wiki** is Markdown pages stored in the same SQLite file. Everyone can read it, admins edit it.
Link pages with `[[Page title]]` or `[[Page title|label]]`; links to pages that don't exist yet show
dashed and create the page when you click them.

## How files are named

Bellhop follows Jellyfin's naming guide:

| Type   | Lands in                                                   |
| ------ | ---------------------------------------------------------- |
| Movie  | `Movies/Dune (2021)/Dune (2021).mkv` (+ `.en.srt` subs)     |
| Series | `Shows/Severance (2022)/Season 02/Severance S02E05.mkv`    |
| Music  | `Music/Pink Floyd/The Dark Side of the Moon/01 - Speak to Me.flac` |

It guesses title, year, season and episode from the file and folder names, and shows the exact target
path before you import. Fix anything that's off right there, or use **Find title** to match against
TMDB/MusicBrainz. It never overwrites an existing file.

**Uploads** use the tus protocol: files go up in 50 MB chunks and resume after a dropped connection
or a page reload. They're staged in `/media/.bellhop-tmp`, so the final move is instant. Unfinished
uploads are cleaned up after 7 days.

**Incoming:** with **Keep originals** on (the default), files are hard-linked into the library, so
torrents keep seeding and no extra space is used. Turn it off to move files instead.

Hard links and instant moves only work within one mount. If downloads are mounted separately as
`/incoming`, Bellhop copies (and uses double the space while seeding). For instant imports, put the
downloads folder inside the media folder and point Bellhop at it with `INCOMING_DIR=/media/Downloads`
instead of a second mount.

## TrueNAS SCALE

Images are published to `ghcr.io/f1f0mp4/bellhop` on every push to `main`
([.github/workflows/cd.yaml](.github/workflows/cd.yaml)).

1. Create a dataset `Main/bellhop` for the database.
2. **Apps → Discover Apps → ⋮ → Install via YAML** and paste [deploy/truenas.yaml](deploy/truenas.yaml).
3. Adjust `PUID`/`PGID` to a user that can write your media dataset, and set `ADMIN_PASSWORD`.

To update, use the app's **Update** button, or **Edit → Save** to pull `latest` again.

## Behind a reverse proxy

Works as is behind Caddy, Traefik, Nginx Proxy Manager or Cloudflare Tunnel. For Nginx, allow large
request bodies on the upload path:

```nginx
client_max_body_size 64m;
```

## Develop

```bash
npm install
npm run dev:server   # API on :8080, data in ./data
npm run dev:web      # UI on :5173 with hot reload
npm test             # filename parser, path safety, status checks
npm run typecheck
```

Requires Node 24 or newer (the server is TypeScript run directly by Node, and uses the built-in
`node:sqlite`).

## Layout

```
server/schema.sql          the whole database schema
server/src/routes/         tickets, users, settings + lookups, media, services, wiki
server/src/services/       status checks, including the Minecraft server ping
server/src/media/naming.ts filename parsing and Jellyfin paths (shared with the web app)
server/src/media/safePath.ts  keeps every file operation inside /media and /incoming
web/src/pages/             user pages, and admin/ for board, media, users, settings
```
