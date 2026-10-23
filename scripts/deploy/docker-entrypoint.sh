#!/bin/sh
set -eu
# A fresh volume needs the core Prisma tables. Existing databases stay intact.
if [ ! -f /var/lib/oskolok/oskolok.db ]; then
  cp /app/bootstrap.db /var/lib/oskolok/oskolok.db
  chmod 600 /var/lib/oskolok/oskolok.db
fi
exec "$@"
