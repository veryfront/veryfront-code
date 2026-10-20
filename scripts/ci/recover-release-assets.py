#!/usr/bin/env python3
"""Publish only preverified original 1283 release assets; never publish npm.

The trusted caller must authenticate canonical artifacts, registry provenance and
qualification before supplying this manifest's expected digest. This helper
checks transport integrity and release conflicts, not that upstream authority.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

VERSION = '0.1.1283'
SOURCE = '8b9eb53979953e4a934014232982cca02eff63b0'
TAG = 'v' + VERSION
REPOSITORY = 'veryfront/veryfront'
API = 'repos/' + REPOSITORY


def require(condition, message):
    if not condition:
        raise ValueError(message)


def unique(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'Duplicate JSON field')
        value[key] = item
    return value


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique)


def gh(args):
    return subprocess.check_output(['gh', *args], stderr=subprocess.PIPE)


def read_api(path, transport):
    return decode(transport(['api', '--method', 'GET', path]))


def discover_release(transport):
    matches = []
    for page in range(1, 11):
        rows = read_api(f'{API}/releases?per_page=100&page={page}', transport)
        require(type(rows) is list and all(type(row) is dict for row in rows), 'Invalid release listing')
        matches.extend(row for row in rows if row.get('tag_name') == TAG)
        require(len(matches) <= 1, 'Duplicate release tags')
        if len(rows) < 100:
            return matches[0] if matches else None
    raise ValueError('Release listing exceeds bounded inventory')


def verify_local_asset(directory, row):
    file = Path(directory) / row['name']
    require(not file.is_symlink() and file.is_file(), 'Missing or symbolic asset')
    with file.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    require(file.stat().st_size == row['size'] and actual == row['sha256'], 'Local asset differs')


def load_manifest(path, expected_sha256, directory):
    require(type(expected_sha256) is str and re.fullmatch('[a-f0-9]{64}', expected_sha256), 'Invalid manifest digest')
    manifest_path = Path(path)
    asset_root = Path(directory).resolve(strict=True)
    require(not manifest_path.is_symlink(), 'Manifest cannot be a symlink')
    manifest_path = manifest_path.resolve(strict=True)
    require(manifest_path in {asset_root / 'manifest.json', asset_root.parent / 'manifest.json'},
            'Manifest must belong to the prepared asset directory')
    raw = manifest_path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_sha256, 'Manifest digest differs')
    value = decode(raw)
    require(type(value) is dict and set(value) == {'schema_version', 'version', 'source_revision', 'assets'}, 'Invalid manifest fields')
    require(type(value['schema_version']) is int and value['schema_version'] == 1
            and value['version'] == VERSION and value['source_revision'] == SOURCE, 'Original release identity differs')
    rows = value['assets']
    require(type(rows) is list and 0 < len(rows) <= 100, 'Invalid asset inventory')
    assets = {}
    for row in rows:
        require(type(row) is dict and set(row) == {'name', 'size', 'sha256'}, 'Invalid asset fields')
        name = row['name']
        require(type(name) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,199}', name)
                and name not in assets, 'Unsafe or duplicate asset name')
        require(type(row['size']) is int and row['size'] > 0
                and type(row['sha256']) is str and re.fullmatch('[a-f0-9]{64}', row['sha256']), 'Invalid asset digest or size')
        verify_local_asset(directory, row)
        assets[name] = row
    return assets


def verify_release(release):
    require(type(release) is dict and type(release.get('id')) is int and release['id'] > 0
            and release.get('tag_name') == TAG and type(release.get('draft')) is bool
            and release.get('prerelease') is False, 'Release identity or mode differs')


def inventory(release, expected, transport, complete=False, allow_starters=False):
    assets = []
    for page in range(1, 3):
        rows = read_api(f'{API}/releases/{release["id"]}/assets?per_page=100&page={page}', transport)
        require(type(rows) is list, 'Invalid remote asset inventory')
        assets.extend(rows)
        if len(rows) < 100:
            break
    require(len(assets) <= len(expected), 'Unexpected remote assets')
    found = set()
    names = set()
    identifiers = set()
    starters = []
    for asset in assets:
        require(type(asset) is dict, 'Invalid remote asset')
        name = asset.get('name')
        require(type(name) is str and name in expected and name not in names, 'Unexpected or duplicate remote asset')
        names.add(name)
        identifier = asset.get('id')
        require(type(identifier) is int and identifier > 0 and identifier not in identifiers, 'Invalid or duplicate asset ID')
        identifiers.add(identifier)
        if allow_starters and release['draft'] and empty_starter(asset):
            starters.append(asset)
            continue
        row = expected[name]
        require(asset.get('state') == 'uploaded' and type(asset.get('size')) is int
                and asset['size'] == row['size'] and asset.get('digest') == 'sha256:' + row['sha256'], 'Remote asset is incomplete or differs')
        found.add(name)
    require(not complete or found == set(expected), 'Release asset inventory incomplete')
    return found, starters


def empty_starter(asset):
    return (asset.get('state') == 'starter' and type(asset.get('size')) is int
            and asset['size'] == 0 and asset.get('digest') in (None, ''))


def clear_starters(release, starters, transport):
    for asset in starters:
        current = read_api(f'{API}/releases/{release["id"]}', transport)
        verify_release(current)
        require(current['id'] == release['id'] and current['draft'], 'Draft changed before starter cleanup')
        path = f'{API}/releases/assets/{asset["id"]}'
        current_asset = read_api(path, transport)
        require(type(current_asset) is dict and current_asset.get('id') == asset['id']
                and current_asset.get('name') == asset['name'] and empty_starter(current_asset),
                'Starter changed before cleanup')
        transport(['api', '--method', 'DELETE', path])


def prevent_latest_downgrade(release, transport):
    latest = read_api(API + '/releases/latest', transport)
    require(type(latest) is dict, 'Invalid latest release')
    if latest.get('id') == release['id'] and latest.get('tag_name') == TAG:
        return
    tag = latest.get('tag_name')
    match = re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', tag) if type(tag) is str else None
    require(match is not None and latest.get('draft') is False and latest.get('prerelease') is False
            and tuple(map(int, match.groups())) < tuple(map(int, VERSION.split('.'))),
            'Latest release is newer or unrecognized; refusing to replace it')


def verify_latest(release, transport):
    latest = read_api(API + '/releases/latest', transport)
    verify_release(latest)
    require(latest['id'] == release['id'] and not latest['draft'], 'Recovered release is not latest')


def recover(manifest, expected_sha256, directory, transport=gh):
    expected = load_manifest(manifest, expected_sha256, directory)
    release = discover_release(transport)
    if release is None:
        transport(['release', 'create', TAG, '--repo', REPOSITORY, '--title', TAG,
                   '--verify-tag', '--draft', '--notes', f'Original tested {VERSION} artifacts from {SOURCE}; no npm republish.'])
        release = discover_release(transport)
    verify_release(release)
    path = f'{API}/releases/{release["id"]}'
    selected_id = release['id']
    release = read_api(path, transport)
    verify_release(release)
    require(release['id'] == selected_id, 'Selected release changed')
    found, starters = inventory(release, expected, transport, complete=not release['draft'], allow_starters=True)
    if not release['draft']:
        verify_latest(release, transport)
        return release
    if starters:
        clear_starters(release, starters, transport)
        found, _ = inventory(release, expected, transport)
    for name in sorted(set(expected) - found):
        # Recheck bytes immediately before upload; --clobber is intentionally absent.
        verify_local_asset(directory, expected[name])
        transport(['api', '--method', 'POST',
                   '-H', 'Content-Type: application/octet-stream', '--input',
                   str((Path(directory) / name).resolve()),
                   f'https://uploads.github.com/{API}/releases/{release["id"]}/assets?name={name}'])
    current = read_api(path, transport)
    verify_release(current)
    require(current['id'] == release['id'] and current['draft'], 'Draft changed during recovery')
    inventory(current, expected, transport, complete=True)
    prevent_latest_downgrade(current, transport)
    transport(['api', '--method', 'PATCH', '-F', 'draft=false', '-F', 'prerelease=false',
               '-f', 'make_latest=true', path])
    final = read_api(path, transport)
    verify_release(final)
    require(final['id'] == release['id'] and not final['draft'], 'Publication was not confirmed')
    inventory(final, expected, transport, complete=True)
    verify_latest(final, transport)
    return final


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--assets-dir', required=True)
    args = parser.parse_args()
    result = recover(args.manifest, args.manifest_sha256, args.assets_dir)
    print(json.dumps({'release_id': result['id'], 'tag': TAG, 'source_revision': SOURCE, 'draft': result['draft']}))


if __name__ == '__main__':
    main()
