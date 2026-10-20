"""Authenticate prepared release data on a fresh runner before write credentials."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('publisher', HERE / 'recover-release-assets.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def verify_archive(path, archive_digest, manifest_digest, destination):
    publisher.require(re.fullmatch('[a-f0-9]{64}', archive_digest or ''), 'Invalid archive digest')
    publisher.require(re.fullmatch('[a-f0-9]{64}', manifest_digest or ''), 'Invalid manifest digest')
    with Path(path).open('rb') as stream:
        publisher.require(hashlib.file_digest(stream, 'sha256').hexdigest() == archive_digest,
                          'Prepared archive differs')
    destination = Path(destination)
    publisher.require(not destination.exists(), 'Destination already exists')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        publisher.require(len(names) == len(set(names)) and 'manifest.json' in names,
                          'Duplicate entries or missing manifest')
        info = archive.getinfo('manifest.json')
        publisher.require(info.file_size <= 1024 * 1024, 'Manifest exceeds bound')
        raw = archive.read(info)
        publisher.require(hashlib.sha256(raw).hexdigest() == manifest_digest, 'Prepared manifest differs')
        manifest = publisher.decode(raw)
        publisher.require(type(manifest) is dict and manifest.get('version') == publisher.VERSION
                          and manifest.get('source_revision') == publisher.SOURCE,
                          'Prepared source identity differs')
        rows = manifest.get('assets')
        publisher.require(type(rows) is list and len(rows) == 45, 'Prepared asset inventory differs')
        expected = {'manifest.json': {'size': len(raw), 'sha256': manifest_digest}}
        for row in rows:
            publisher.require(type(row) is dict and type(row.get('name')) is str
                              and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,199}', row['name']),
                              'Unsafe prepared asset')
            name = 'assets/' + row['name']
            publisher.require(name not in expected and type(row.get('size')) is int
                              and 0 < row['size'] <= 2 * 1024**3
                              and re.fullmatch('[a-f0-9]{64}', row.get('sha256', '')),
                              'Invalid prepared asset identity')
            expected[name] = row
        publisher.require(set(names) == set(expected), 'Prepared archive inventory differs')
        for entry in entries:
            publisher.require(not entry.is_dir() and not entry.flag_bits & 1
                              and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG)
                              and entry.file_size == expected[entry.filename]['size'],
                              'Unsafe prepared archive member')
        destination.mkdir()
        (destination / 'assets').mkdir()
        for entry in entries:
            target = destination / entry.filename
            digest = hashlib.sha256()
            with archive.open(entry) as source, target.open('xb') as output:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    output.write(chunk)
            publisher.require(digest.hexdigest() == expected[entry.filename]['sha256'],
                              'Prepared asset bytes differ')
    publisher.load_manifest(destination / 'manifest.json', manifest_digest, destination / 'assets')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-id', type=int, required=True)
    parser.add_argument('--archive-sha256', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    publisher.require(args.artifact_id > 0, 'Invalid prepared artifact ID')
    prefix = 'repos/veryfront/veryfront-code/actions/artifacts/' + str(args.artifact_id)
    metadata = json.loads(subprocess.check_output(['gh', 'api', prefix], timeout=45))
    run = metadata.get('workflow_run', {})
    publisher.require(metadata.get('id') == args.artifact_id and metadata.get('expired') is False
                      and metadata.get('name') == 'qualified-original-1283-' + os.environ['GITHUB_RUN_ID']
                      and run.get('id') == int(os.environ['GITHUB_RUN_ID'])
                      and run.get('head_sha') == os.environ['GITHUB_SHA']
                      and metadata.get('digest') == 'sha256:' + args.archive_sha256,
                      'Prepared artifact producer or digest differs')
    with tempfile.TemporaryDirectory() as directory:
        archive = Path(directory) / 'prepared.zip'
        with archive.open('xb') as output:
            subprocess.run(['gh', 'api', prefix + '/zip'], stdout=output, check=True, timeout=600)
        publisher.require(archive.stat().st_size == metadata.get('size_in_bytes'),
                          'Prepared archive size differs')
        verify_archive(archive, args.archive_sha256, args.manifest_sha256, args.destination)
    print('Prepared release data authenticated. No write credentials used.')


if __name__ == '__main__':
    main()
