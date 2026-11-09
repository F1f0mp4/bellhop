# Bellhop

A small front desk for your homelab. People in your household sign in and ring the bell when
something's broken, when they have an idea, or when they want a movie, series or album. You get a
board to work through those requests, and a drag-and-drop screen that puts media files into the
right Jellyfin folders, so you never have to SSH into the disk again.

- **For everyone:** send a request, search movies/shows/albums with posters, see status and replies.
  Browse the **Apps** page for open source apps picked for the house, and read the **wiki**.
- **For you:** kanban board, replies, user accounts, a media drop-off that uploads from your browser
  or sorts files already sitting in your downloads folder, library sizes and watch time, and a speed
  test that checks the real upload path.
- **Side panel:** one place with every service (Jellyfin, Crafty, Minecraft servers…) and whether
  it's up.
- **Storage:** one SQLite file (`data/bellhop.db`) plus a few folders next to it. No database server.
  Back it up by copying the `data` folder.

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

- **Users:** add an account for each person. The list shows when each one was last seen.
- **Settings:** add your Jellyfin URL and API key (Jellyfin → Dashboard → API Keys) so imports trigger
  a rescan and the Media page can show watch time. Add a free
  [TMDB](https://www.themoviedb.org/settings/api) key for movie/show posters and search. Music search
  uses MusicBrainz and needs no key. A GitHub token is optional (see [Apps](#apps)).

If you leave `ADMIN_PASSWORD` empty, a random one is printed in the logs on first start
(`docker compose logs bellhop`). The running version is shown in the app and at the top of the
container log.

### Settings

Everything below can be set as an environment variable. The ones marked *Settings* can also be
changed in the app later, and the app's value wins.

| Variable                         | Default     | What it does                                                    |
| -------------------------------- | ----------- | --------------------------------------------------------------- |
| `ADMIN_USER` / `ADMIN_PASSWORD`  | `admin` / random | First admin account, created on first start only           |
| `PUID` / `PGID`                  | `1000`      | User the server runs as, so imported files belong to you        |
| `PORT`                           | `8080`      |                                                                 |
| `DATA_DIR`                       | `/data`     | Database, wiki images, app files                                |
| `MEDIA_DIR`                      | `/media`    | Folder that holds the Jellyfin libraries                        |
| `INCOMING_DIR`                   | `/incoming` | Downloads folder to sort from                                   |
| `MOVIES_DIR` / `SHOWS_DIR` / `MUSIC_DIR` | `Movies` / `Shows` / `Music` | Library folder names inside `MEDIA_DIR` (*Settings*) |
| `JELLYFIN_URL` / `JELLYFIN_KEY`  |             | Rescan after imports, watch time (*Settings*)                   |
| `TMDB_KEY`                       |             | Posters and search for movies and shows (*Settings*)            |
| `GITHUB_TOKEN`                   |             | More GitHub lookups for app updates (*Settings*)                |

Only `/data` has to be writable. If the top of the media mount belongs to someone else (common on
TrueNAS), Bellhop still starts: it only needs the library folders, stages uploads in `/data/uploads`
if it can't use `/media/.bellhop-tmp`, and the Media page says which folders it can't write to and as
which `uid:gid`.

## Media drop-off

The **Media** page has three parts: upload from the browser, sort from the incoming folder, and browse
the library.

## How files are named

Bellhop follows Jellyfin's naming guide:

| Type   | Lands in                                                   |
| ------ | ---------------------------------------------------------- |
| Movie  | `Movies/Dune (2021)/Dune (2021).mkv` (+ `.en.srt` subs)     |
| Series | `Shows/Severance (2022)/Season 02/Severance S02E05.mkv`    |
| Music  | `Music/Pink Floyd/The Dark Side of the Moon/01 - Speak to Me.flac` |

It guesses title, year, season and episode from the file and folder names, and shows the exact target
path before you import. Fix anything that's off right there, or use **Find title** to match against
TMDB/MusicBrainz. It never overwrites an existing file. An import can also mark the request it
fulfils as done.

### Uploads

Uploads use the tus protocol: files go up in 16 MB pieces and resume after a dropped connection or a
page reload. Each file shows its speed and time left, and the bottom bar shows the total for
everything still queued.

Connections that stall mid-piece (the request stays open but nothing moves) are recovered
automatically: after 20 seconds without progress the piece is restarted from where the server got to.
A piece that's fully sent and waiting on a slow disk gets 5 minutes before that happens. Slow and
interrupted pieces are written to the container log.

Files are staged in `/media/.bellhop-tmp`, so the final move into the library is instant. Unfinished
uploads are cleaned up after 7 days.

### Incoming

With **Keep originals** on (the default), files are hard-linked into the library, so torrents keep
seeding and no extra space is used. Turn it off to move files instead.

Hard links and instant moves only work within one mount. If downloads are mounted separately as
`/incoming`, Bellhop copies (and uses double the space while seeding). For instant imports, put the
downloads folder inside the media folder and point Bellhop at it with `INCOMING_DIR=/media/Downloads`
instead of a second mount.

### Library

The **Library** tab has a card per category with disk use, counts and watch time, and every folder
row shows its size. Movies and shows are counted by Jellyfin; music is counted from the folder
(artists, albums, tracks), since it may be served by something else like Navidrome. Folders Jellyfin
hasn't indexed yet fall back to folder counts.

Sizes come from an index kept in memory, walked in the background at start and every 6 hours.
Imports, renames and deletes re-read only the folder they touch; the refresh button re-reads the
current folder if you changed things over SMB. Jellyfin's hidden `.chapters` and `.trickplay` folders
count toward sizes.

You can rename and delete from here. If a delete is refused, Bellhop removes everything it can and
names the file it left behind and why: locked, in use, or a folder the Bellhop user can't write to
(ZFS refuses deletes in Jellyfin's `755` folders, for example).

## Apps

The **Apps** page is a small app store for the household: open source apps with a download for each
platform. It opens on the visitor's own platform (iPhone, Android, Mac, Windows, Linux), and each app
has a page with its description, version and licence.

On first start it's filled with a starter list (Jellyfin, Finamp, VLC, Firefox, Bitwarden, Signal,
LocalSend, Home Assistant and about twenty more). Remove what you don't want; removed apps stay in the
starter list under **Manage apps** to add back later.

The starter list also has **FreeCAD**, **OrcaSlicer**, **Ollama**, **Zed** (an AI code editor that works with Ollama), **Arduino IDE**
and **Thonny** with
their installers kept on this server, so they still install when the internet is down. On a Bellhop
that was already running, add them from **Manage apps → Starter list**. Together they take about 10 GB, half of it Ollama.
Like every release file, they always follow the project's latest stable GitHub release; previews,
release candidates and nightlies are skipped. [docs/offline-apps.md](docs/offline-apps.md) explains
installing and setting them up on Mac, Windows and Linux, including Zed with Ollama as an offline AI
code editor.

Each download is one of:

- **Link:** App Store, Google Play, F-Droid, Flathub or a website.
- **Release file:** matched by a pattern like `*-arm64.dmg` against the app's latest GitHub release.
  Bellhop checks for new releases 20 seconds after start and every 12 hours, or when you press
  **Check for updates**. Tick **Keep a copy on this server** to serve the file from here instead of
  GitHub. Checksums and signatures
  in a release are ignored unless the pattern asks for them.
- **Upload:** a file you put on the server yourself.

Without a token GitHub allows 60 lookups an hour. A fine-grained token with no permissions at all
(public repositories only) raises that to 5,000; add it under **Settings → GitHub**.

### iPhone apps that aren't on the App Store

An `.ipa` can't be installed on an iPhone directly, so Bellhop publishes an **AltStore source**, which
SideStore reads too. Every `.ipa` on the server (iOS release files are always kept) shows up there,
with its bundle id, version, minimum iOS and permissions read from the file itself.

The Apps page shows the source with one-tap buttons to add it to SideStore or AltStore. The address
contains a secret key so phones can fetch it without signing in; **Manage apps** shows it and can
issue a new one if it leaks. If nobody has SideStore yet, it's in the starter list.

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

- Link pages with `[[Page title]]` or `[[Page title|label]]`; links to pages that don't exist yet show
  dashed and create the page when you click them.
- Each page can have a **category**. The index groups pages by category with filter buttons, and
  search matches category names.
- Pages show who added them and who last changed them.
- **Images:** add them from the toolbar, by pasting, or by dropping files on the editor. PNG, JPEG,
  GIF and WebP up to 10 MB. SVG is refused, since it could run scripts. Images live in
  `data/wiki-images` and are only served to signed-in users.

## Speed test

**Speed test** (admins) measures ping, jitter, download and upload between your browser and Bellhop,
then sends one real 16 MB piece through the upload path and reports whether it was saved and how long
the reply took. Use it when uploads are slow, to tell the network apart from the disk or a proxy.

## TrueNAS SCALE

Images are published to `ghcr.io/f1f0mp4/bellhop` for amd64 and arm64 after typecheck and tests pass
([.github/workflows/cd.yaml](.github/workflows/cd.yaml)). `main` is tagged `latest`; a `v1.2.3` git
tag also publishes `1.2.3`, `1.2` and `1`.

1. Create a dataset `Main/bellhop` for the data folder.
2. **Apps → Discover Apps → ⋮ → Install via YAML** and paste [deploy/truenas.yaml](deploy/truenas.yaml).
3. Adjust `PUID`/`PGID` to a user that can write your media dataset, and set `ADMIN_PASSWORD`.

To update, use the app's **Update** button, or **Edit → Save** to pull `latest` again.

## Behind a reverse proxy

Works as is behind Caddy, Traefik, Nginx Proxy Manager or Cloudflare Tunnel. For Nginx, allow request
bodies bigger than one upload piece:

```nginx
client_max_body_size 64m;
```

## Develop

```bash
npm install
npm run dev:server   # API on :8080, data in ./data
npm run dev:web      # UI on :5173 with hot reload
npm test             # node:test, server/test/*.test.ts
npm run typecheck
```

Requires Node 24 or newer: the server is TypeScript run directly by Node, with no build step, and
uses the built-in `node:sqlite`. The server runs on Hono with `@tus/server` for uploads; the web app
is React 19, React Router, Tailwind 4 and Vite.

The tests cover the filename parser, path safety, library deletes and size index, status checks,
wiki images, and the Apps code (GitHub asset matching, `.ipa` reading, the AltStore source).

## Layout

```
server/schema.sql              the whole database schema
server/src/index.ts            starts everything; tus uploads are handled ahead of Hono
server/src/routes/             tickets, users, settings + lookups, media, services, wiki, apps, speed test
server/src/media/naming.ts     filename parsing and Jellyfin paths (shared with the web app)
server/src/media/safePath.ts   keeps every file operation inside /media and /incoming
server/src/media/sizes.ts      the in-memory folder size index
server/src/media/removeTree.ts deletes that report what they couldn't remove
server/src/services/           status checks, including the Minecraft server ping
server/src/apps/               starter list, GitHub releases, .ipa reader, AltStore source
server/src/lookup/             TMDB and MusicBrainz
web/src/pages/                 user pages, apps/, wiki/, and admin/ for board, media, apps, users, settings

data/bellhop.db                tickets, users, settings, wiki, apps
data/wiki-images/              wiki images
data/apps/                     kept app files and icons
```

## What's been built

From newest to oldest:

- **Apps page:** a household app store with a starter list of open source apps, per-platform
  downloads from links, GitHub releases or uploads, twice-daily release checks, and an AltStore /
  SideStore source for iPhone apps outside the App Store.
- **Wiki:** images (toolbar, paste, drop), page authors, and categories.
- **Media page:** library sizes per folder, per-category cards with watch time from Jellyfin, and music
  counted from the folder instead of Jellyfin.
- **Library deletes:** remove everything possible and name the file that was left behind, blaming
  folder permissions rather than locks when that's the cause.
- **Uploads:** stall recovery, speed and time left, a switch to tus's Node handler so dropped
  connections release their lock, 16 MB pieces, a longer wait for pieces the server is still saving,
  and pieces read into memory before sending (Safari stalled after each piece otherwise).
- **Speed test page** with a real upload check.
- **Running version** shown in the app and the container log.
- **Users** list shows when people were last seen.
- **Starts with a read-only media root,** staging uploads in `/data` if needed and reporting which
  folders aren't writable.
- **Database:** waits for the lock when two processes create it at once.
- **Docker image on GHCR** for amd64 and arm64, plus the TrueNAS SCALE setup.
- **First version:** requests with TMDB/MusicBrainz search, duplicate checks, replies and a status
  timeline; the admin board; resumable uploads and incoming sorting into Jellyfin's layout; the side
  panel with live status and Minecraft ping; the Markdown wiki; one SQLite file; Docker with
  `PUID`/`PGID`.
