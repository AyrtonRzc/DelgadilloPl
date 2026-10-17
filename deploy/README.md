# DelgadilloPl — VPS private preview (no database)

This configuration is **a private static preview only**, not a functioning tournament service. The current frontend uses Supabase auth and table queries; a compatible API, authentication and database migration are a separate change. Do not publish this preview or accept real user data.

## Scope and guarantees

- Does not change ERP files, volumes, networks, containers, CI/CD or reverse-proxy.
- Does not build images locally: uses the pre-existing `caddy:2-alpine` image with `pull_policy: never`.
- Only host binding: `127.0.0.1:18080` (not publicly accessible).
- Read-only site and container filesystem, an 8 MiB tmpfs, 64 MiB RAM limit, 0.20 vCPU quota, 32 PID limit.
- Container logs are capped at two 2 MiB files.
- No mounted databases, Docker volume, local build cache, anonymous registry, app writes or internet-exposed ports.
- Does not run privileged or join the ERP edge network.
- The official Caddy binary carries a `NET_BIND_SERVICE` file capability. Compose drops all capabilities and adds back **only** that one to avoid `exec caddy failed: Operation not permitted`; user remains non-root and `no-new-privileges` stays enabled.

## Initial installation on HostGator VPS (as deploy-erp)

Never run when an ERP deploy is in progress. Inspect first:
```sh
docker ps --format 'table {{.Names}}\t{{.Status}}'
df -h /
docker image inspect caddy:2-alpine --format '{{.Id}}'
```

```sh
sudo install -d -m 0755 -o "$(id -un)" -g "$(id -gn)" /opt/delgadillopl
mkdir -p /opt/delgadillopl/site
git clone --depth=1 --branch main https://github.com/Delgadillox/DelgadilloPl.git /opt/delgadillopl/source

# Never expose .git, workflows or internal deployment files to the web.
rsync -a --delete \
  --exclude='.git/' --exclude='.github/' \
  --exclude='deploy/' --exclude='docs/' \
  /opt/delgadillopl/source/ /opt/delgadillopl/site/

DELGADILLOPL_SITE_DIR=/opt/delgadillopl/site \
  docker compose -p delgadillopl-preview \
  -f /opt/delgadillopl/source/deploy/compose.preview.yml \
  config -q

DELGADILLOPL_SITE_DIR=/opt/delgadillopl/site \
  docker compose -p delgadillopl-preview \
  -f /opt/delgadillopl/source/deploy/compose.preview.yml \
  up -d --no-build --pull never --wait
```

Check:
```sh
docker ps --filter name=delgadillopl-preview
curl -fsSI http://127.0.0.1:18080/
df -h /
docker system df
```

From your Windows computer, open an SSH tunnel (in a different PowerShell tab):
```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" -p 22022 -L 18080:127.0.0.1:18080 deploy-erp@108.174.152.54
```
Open `http://localhost:18080/` locally. The UI may load, but signup/login/data will not work until the backend migration is completed.

## Updating the static preview

```sh
cd /opt/delgadillopl/source
git fetch --depth=1 origin main
git reset --hard origin/main
rsync -a --delete \
  --exclude='.git/' --exclude='.github/' \
  --exclude='deploy/' --exclude='docs/' \
  /opt/delgadillopl/source/ /opt/delgadillopl/site/
```
No container recreation, build, image pull or layer cache is required for purely static changes.

## Stop / uninstall

```sh
DELGADILLOPL_SITE_DIR=/opt/delgadillopl/site \
  docker compose -p delgadillopl-preview \
  -f /opt/delgadillopl/source/deploy/compose.preview.yml down
```
This removes only the preview container and its project network. It leaves the static sources intact. Do not use broad Docker prune commands or remove any ERP Docker resources.

## Production requirements (not implemented by this preview)

- Replace Supabase auth and all table/RPC/realtime client calls with a proper backend API.
- Use a separately backed-up SQLite DB with WAL and migrations under `/opt/delgadillopl/data`.
- Use Argon2id/bcrypt, secure HttpOnly sessions, authorization checks and bounded backups, with a process for recovering the service.
- Review permissions for public spectator data and match updates; do not expose operator tokens/credentials.
- Run tests, publish only after a private functional smoke test, then coordinate a **minimal, rollbackable** new hostname in the existing Caddy edge config.
- Keep extra workloads subordinate to ERP builds/releases; never compile the app on the VPS.
