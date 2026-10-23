#!/usr/bin/python3
"""Consistent SQLite snapshot plus encryption key and uploaded user files."""
from datetime import datetime, timezone
from pathlib import Path
import os
import sqlite3
import tarfile
import tempfile

os.umask(0o077)
data = Path('/var/lib/oskolok')
backups = Path('/var/backups/oskolok')
backups.mkdir(mode=0o700, parents=True, exist_ok=True)
name = 'oskolok-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.tar.gz'
partial = backups / (name + '.partial')
with tempfile.TemporaryDirectory(prefix='oskolok-backup-') as work:
    snapshot = Path(work) / 'oskolok.db'
    with sqlite3.connect(f'file:{data / "oskolok.db"}?mode=ro', uri=True) as source:
        with sqlite3.connect(snapshot) as target:
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Database integrity check failed')
    with tarfile.open(partial, 'w:gz') as archive:
        archive.add(snapshot, arcname='oskolok.db')
        for folder in ('private', 'user-content'):
            archive.add(data / folder, arcname=folder)
    partial.rename(backups / name)
archives = sorted(backups.glob('oskolok-*.tar.gz'), reverse=True)
for old in archives[14:]:
    old.unlink()
print('Backup completed:', name)
