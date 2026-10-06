# Self-hosting with server saves

By default Pillage First! runs entirely in the browser and keeps game worlds in
that browser's storage. The self-hosted server instead runs the game worlds on
your server and keeps the saves there, so you can play the same world from any
device: a desktop, a laptop or a phone.

The game keeps running on the server while no one is connected; events that
are due are resolved when the world is opened again, the same as in the browser
version.

## Quick start (Docker)

```sh
git clone <this repository>
cd <repository>
GAME_PASSWORD=choose-a-password docker compose up -d --build
```

Open `http://<your-server>:3000`, enter the password, and create or import a
game world. Every device that logs in with the password sees the same worlds.

To update to a newer version of the game:

```sh
git pull
GAME_PASSWORD=choose-a-password docker compose up -d --build
```

Saves are upgraded to the new version when a world is opened.

## Configuration

| Variable            | Default                  | Description                                                                 |
| ------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `GAME_PASSWORD`     | (required)               | Password needed to play. Changing it logs out every device.                 |
| `ALLOW_NO_PASSWORD` | `false`                  | Set to `true` to run without a password, e.g. on a private network only.   |
| `PORT`              | `3000`                   | Port the server listens on.                                                 |
| `HOST`              | `0.0.0.0`                | Address the server listens on.                                              |
| `DATA_DIR`          | `/data` (Docker)         | Where game worlds are saved.                                                |
| `STATIC_DIR`        | `/app/web` (Docker)      | The built web app.                                                          |

## Saves and backups

Everything lives in the data volume (`pillage-first-data` in
`docker-compose.yml`, mounted at `/data`):

- `worlds.json`: the list of game worlds
- `worlds/<slug>.sqlite3`: one save file per game world
- `session-secret`: signs login cookies

Worlds are saved every few seconds while they change, and when the container
stops. `docker compose down` waits up to 30 seconds for the saves to finish.

To back up, copy the volume, for example:

```sh
docker run --rm -v pillage-first-data:/data -v "$PWD":/backup busybox \
  tar czf /backup/pillage-first-backup.tgz -C /data .
```

You can also download a single world from the game world list with
**Export**, and load it back with **Import**.

## Moving worlds from the browser version

Worlds you already played in the browser version stay in that browser. To move
one to the server:

1. Open the browser version where the world is saved and choose **Export** on
   the game world list. This downloads a `.sqlite3` file.
2. Open the self-hosted server, log in, and choose **Import** with that file.

## HTTPS

The server speaks plain HTTP. If the game is reachable from the internet, put
it behind a reverse proxy that handles HTTPS, so the password and login cookie
are encrypted. The server marks the login cookie as secure when the proxy sends
`X-Forwarded-Proto: https`.

Example with Caddy:

```
game.example.com {
  reverse_proxy localhost:3000
}
```

Example with nginx (the game uses server-sent events, so buffering must be off
for `/api/worlds/*/events`; the server already sends `X-Accel-Buffering: no`):

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_http_version 1.1;
  proxy_read_timeout 1h;
  client_max_body_size 1g;
}
```

`client_max_body_size` allows importing large saves.

## Running without Docker

Requires Node.js 22 or newer.

```sh
npm ci
VITE_GAME_SERVER=true npx turbo run build --filter=@pillage-first/web --filter=@pillage-first/server
GAME_PASSWORD=choose-a-password DATA_DIR=./data node apps/server/build/main.js
```

The web app must be built with `VITE_GAME_SERVER=true`; a normal build keeps
saves in the browser.

## Notes

- One person at a time per world works best. Two devices can have the same
  world open; both see the same state, but views refresh when the game sends
  an update rather than instantly on every action.
- Login attempts are limited to 10 per 10 minutes per IP address.
