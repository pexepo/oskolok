#!/usr/bin/env python3
"""Build and sign the HTTPS Android client using official SDK tools, without Gradle."""
from pathlib import Path
import hashlib
import os
import secrets
import shutil
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET

project = Path(__file__).resolve().parent.parent
installed = Path.home() / '.local/share/oskolok-build-tools'
sdk = Path(os.environ.get('ANDROID_HOME', installed / 'android-sdk'))
java_home = os.environ.get('JAVA_HOME')
if not java_home and (installed / 'java-home.txt').exists():
    java_home = (installed / 'java-home.txt').read_text().strip()
if not java_home:
    raise SystemExit('Set JAVA_HOME to JDK 17 and ANDROID_HOME to the Android SDK.')
java = Path(java_home) / 'bin'
tools = sdk / 'build-tools/35.0.0'
android_jar = sdk / 'platforms/android-35/android.jar'
if not android_jar.exists() or not (tools / 'aapt2').exists():
    raise SystemExit('Install platforms;android-35 and build-tools;35.0.0 using sdkmanager.')
environment = {**os.environ, 'JAVA_HOME': java_home, 'PATH': str(java) + os.pathsep + os.environ.get('PATH', '')}
def run(args):
    subprocess.run([str(a) for a in args], env=environment, check=True)

# Keep the same private signing key for future upgrades; never package it.
key_dir = Path.home() / '.config/oskolok/android-signing'
key_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
key_dir.chmod(0o700)
keystore = key_dir / 'release.jks'
password_file = key_dir / 'password'
if keystore.exists() and not password_file.exists():
    raise SystemExit('Existing keystore password is missing; refusing to replace the key.')
if not password_file.exists():
    fd = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(secrets.token_urlsafe(32))
if not keystore.exists():
    run([java / 'keytool', '-genkeypair', '-keystore', keystore, '-storepass:file', password_file,
         '-keypass:file', password_file, '-alias', 'oskolok', '-keyalg', 'RSA', '-keysize', '3072',
         '-validity', '10000', '-dname', 'CN=Oskolok', '-noprompt'])
    keystore.chmod(0o600)

out = project / 'release/distribution'
out.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='oskolok-apk-') as temporary:
    work = Path(temporary)
    generated, classes, dex = work / 'generated', work / 'classes', work / 'dex'
    for directory in (generated, classes, dex): directory.mkdir()
    run([tools / 'aapt2', 'compile', '--dir', project / 'android/res', '-o', work / 'resources.zip'])
    run([tools / 'aapt2', 'link', '-I', android_jar, '--manifest', project / 'android/AndroidManifest.xml',
         '--java', generated, '-o', work / 'unsigned.apk', work / 'resources.zip'])
    sources = list((project / 'android/src').rglob('*.java')) + list(generated.rglob('*.java'))
    run([java / 'javac', '-source', '8', '-target', '8', '-encoding', 'UTF-8', '-classpath', android_jar, '-d', classes, *sources])
    run([tools / 'd8', '--release', '--min-api', '26', '--lib', android_jar, '--output', dex, *classes.rglob('*.class')])
    with zipfile.ZipFile(work / 'unsigned.apk', 'a', zipfile.ZIP_DEFLATED) as apk:
        apk.write(dex / 'classes.dex', 'classes.dex')
    run([tools / 'zipalign', '-f', '-p', '4', work / 'unsigned.apk', work / 'aligned.apk'])
    version=ET.parse(project / 'android/AndroidManifest.xml').getroot().get('{http://schemas.android.com/apk/res/android}versionName')
    artifact = out / f'Oskolok-{version}.apk'
    run([tools / 'apksigner', 'sign', '--ks', keystore, '--ks-key-alias', 'oskolok',
         '--ks-pass', 'file:' + str(password_file),
         '--out', artifact, work / 'aligned.apk'])
    run([tools / 'apksigner', 'verify', '--verbose', artifact])
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    print(f'Built {artifact.name}; SHA-256 {digest}')
