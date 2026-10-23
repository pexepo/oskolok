#!/usr/bin/env bash
set -euo pipefail
release_id=${1:?Release ID required}
[[ $release_id =~ ^[0-9]{14}$ ]] || exit 2
exec 9>/run/oskolok-deploy.lock
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
release_dir=/opt/oskolok/releases/$release_id
archive=/tmp/oskolok-$release_id.tar.gz
previous=$(readlink -f /opt/oskolok/current)
trap 'rm -f "$archive"' EXIT
mkdir -m 755 "$release_dir"
tar -xzf "$archive" -C "$release_dir"
cd "$release_dir"
npm ci --no-audit --no-fund
npm run build:server
DATABASE_URL=file:"$release_dir/qa.db" npx prisma db push --skip-generate
NODE_ENV=test DATABASE_URL=file:"$release_dir/qa.db" TELEGRAM_BOT_TOKEN='' OSKOLOK_PRIVATE_DIR="$release_dir/qa-private" USER_CONTENT_DIR="$release_dir/qa-content" npm test > checks.log 2>&1 || { tail -60 checks.log; exit 1; }
tail -8 checks.log
rm -f qa.db qa.db-wal qa.db-shm
rm -rf qa-private qa-content
npm prune --omit=dev --no-audit --no-fund
npm audit --omit=dev --audit-level=high
# Already-open clients may still request old hashed lazy chunks during rollout.
cp -an "$previous/dist/assets/." "$release_dir/dist/assets/"
mkdir -p server
node scripts/deploy/link-data.mjs "$release_dir/server/data" /var/lib/oskolok/data
if [[ -f $previous/.spotify-cooldown.local ]]; then cp "$previous/.spotify-cooldown.local" .spotify-cooldown.local; fi
chown -R root:oskolok "$release_dir"
chmod -R g+rX,o-rwx "$release_dir"
systemd-run --quiet --wait --pipe --collect --unit="oskolok-cache-check-$release_id" \
  -p User=oskolok -p Group=oskolok -p ProtectSystem=strict -p ProtectHome=true \
  -p PrivateTmp=true -p NoNewPrivileges=true -p ReadWritePaths=/var/lib/oskolok \
  -p "WorkingDirectory=$release_dir" /usr/local/bin/node scripts/deploy/check-cache.mjs
systemctl start oskolok-backup
ln -s "$release_dir" /opt/oskolok/current.next
mv -Tf /opt/oskolok/current.next /opt/oskolok/current
rollback() {
  echo 'New release did not start; restoring previous release'
  ln -s "$previous" /opt/oskolok/current.rollback
  mv -Tf /opt/oskolok/current.rollback /opt/oskolok/current
  systemctl restart oskolok
}
if ! systemctl restart oskolok; then rollback; exit 1; fi
healthy=0
for attempt in {1..20}; do
  if curl -fsS http://127.0.0.1:5000/api/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
if [[ $healthy != 1 ]]; then rollback; exit 1; fi
expected=$(node -p 'JSON.parse(require("fs").readFileSync("dist/version.json")).buildId')
actual=$(curl -fsS http://127.0.0.1:5000/version.json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).buildId')
if [[ $actual != "$expected" ]]; then rollback; exit 1; fi
echo "Active release: $release_id"
