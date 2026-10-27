#!/usr/bin/env python3
"""Create only the two pinned original 1283 tags; never move existing refs."""
import argparse
import json
import subprocess

TAG = 'v0.1.1283'
TARGETS = {'veryfront/veryfront': 'f8ac0969c8d874b7c3a891cf007a8a3351fa7011',
           'veryfront/veryfront-code': '8b9eb53979953e4a934014232982cca02eff63b0'}
SOURCE_REPO = 'veryfront/veryfront-code'


def require(condition, message):
    if not condition: raise ValueError(message)


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON field')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique)


def gh(args):
    return subprocess.check_output(['gh', *args], stderr=subprocess.PIPE)


def read_api(path, transport, allow_absent=False):
    try:
        return decode(transport(['api', '--method', 'GET', path]))
    except subprocess.CalledProcessError as error:
        if allow_absent:
            try:
                value = decode(error.output)
                if type(value) is dict and str(value.get('status')) == '404' and value.get('message') == 'Not Found':
                    return None
            except (ValueError, TypeError):
                # Malformed error bodies cannot establish absence; re-raise the API failure.
                pass
        raise


def verify_ref(value, target):
    require(type(value) is dict and value.get('ref') == 'refs/tags/' + TAG
            and type(value.get('object')) is dict and value['object'].get('type') == 'commit'
            and value['object'].get('sha') == target, 'Existing tag is not the exact pinned commit')


def find_release(repository, transport):
    owner, name = repository.split('/')
    query = ('query($owner:String!,$name:String!,$tag:String!){'
             'repository(owner:$owner,name:$name){release(tagName:$tag){'
             'databaseId tagName isDraft isPrerelease}}}')
    value = decode(transport(['api', 'graphql', '-f', 'query=' + query,
                              '-f', 'owner=' + owner, '-f', 'name=' + name, '-f', 'tag=' + TAG]))
    require(type(value) is dict and not value.get('errors') and type(value.get('data')) is dict,
            'Release query failed')
    repo = value['data'].get('repository')
    require(type(repo) is dict and 'release' in repo, 'Release repository unavailable')
    release = repo['release']
    if release is None:
        return None
    require(type(release) is dict and type(release.get('databaseId')) is int
            and release['databaseId'] > 0 and release.get('tagName') == TAG
            and type(release.get('isDraft')) is bool and type(release.get('isPrerelease')) is bool,
            'Release query identity or mode differs')
    exact = read_api(f'repos/{repository}/releases/{release["databaseId"]}', transport)
    require(type(exact) is dict and type(exact.get('id')) is int and exact['id'] == release['databaseId']
            and exact.get('tag_name') == TAG and exact.get('draft') is release['isDraft']
            and exact.get('prerelease') is release['isPrerelease'], 'Release readback differs')
    return exact


def find_source_release(transport):
    return find_release(SOURCE_REPO, transport)


def verify_source_release(value):
    require(type(value) is dict and type(value.get('id')) is int and value['id'] > 0
            and value.get('tag_name') == TAG
            and value.get('draft') is False and value.get('prerelease') is False,
            'Source release identity or mode differs')


def finish_source_release(transport):
    release = find_source_release(transport)
    if release is None:
        transport(['release', 'create', TAG, '--repo', SOURCE_REPO, '--verify-tag',
                   '--title', TAG, '--latest=false',
                   '--notes', 'Original tested 0.1.1283 release; no npm republish. Binaries: https://github.com/veryfront/veryfront/releases/tag/' + TAG])
        release = find_source_release(transport)
    verify_source_release(release)
    exact = read_api(f'repos/{SOURCE_REPO}/releases/{release["id"]}', transport)
    verify_source_release(exact)
    require(exact['id'] == release['id'], 'Source release changed')
    return exact


def recover(repository, transport=gh, source_release=False):
    require(repository in TARGETS, 'Repository is outside original release scope')
    require(not source_release or repository == SOURCE_REPO, 'Source release requires private source repository')
    target = TARGETS[repository]
    prefix = 'repos/' + repository
    commit = read_api(prefix + '/git/commits/' + target, transport)
    require(type(commit) is dict and commit.get('sha') == target, 'Pinned commit unavailable')
    path = prefix + '/git/ref/tags/' + TAG
    value = read_api(path, transport, allow_absent=True)
    if value is None:
        transport(['api', '--method', 'POST', '-f', 'ref=refs/tags/' + TAG,
                   '-f', 'sha=' + target, prefix + '/git/refs'])
        value = read_api(path, transport)
    verify_ref(value, target)
    if source_release:
        finish_source_release(transport)
        value = read_api(path, transport)
        verify_ref(value, target)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True, choices=TARGETS)
    parser.add_argument('--source-release', action='store_true')
    args = parser.parse_args()
    value = recover(args.repository, source_release=args.source_release)
    print(json.dumps({'repository': args.repository, 'tag': TAG, 'target': value['object']['sha']}))


if __name__ == '__main__': main()
