"""Pure identity checks for recovery of the original 0.1.1283 artifacts.

No networking, extraction, publishing or cryptographic attestation verification.
Call the canonical npm artifact verifier before registry comparison. A decoded
SLSA statement is only an identity check, never a verified signature receipt.
"""
import base64
import hashlib
import io
import pathlib
import stat
import zipfile

VERSION = '0.1.1283'
SOURCE = '8b9eb53979953e4a934014232982cca02eff63b0'
REPOSITORY = 'veryfront/veryfront-code'
TESTED_RUN = 39462808561
MAIN_RUN = 39465167710
NPM_ARTIFACT = 12282639696
NPM_ARCHIVE_SHA256 = '84788fa1a06554c634e0867f5d882b027d3cf44fa08a23df885dea40c41a0363'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_run(run, expected_run_id, event, ref, workflow_path, required_jobs, jobs):
    """Authenticate run identity and each exact, unique required successful job."""
    require(expected_run_id in (TESTED_RUN, MAIN_RUN), 'Unpinned producer run')
    pinned_event, pinned_ref = ('push', 'main') if expected_run_id == MAIN_RUN else (
        'merge_group', 'gh-readonly-queue/main/pr-5346-431d4eee7807b0dd9928f0b2edf116adf282d9a8')
    require((event, ref, workflow_path) == (pinned_event, pinned_ref, '.github/workflows/cicd.yml'),
            'Unpinned workflow identity')
    expected = {'id': expected_run_id, 'run_attempt': 1, 'event': event,
                'head_branch': ref, 'head_sha': SOURCE, 'path': workflow_path,
                'status': 'completed'}
    for key, value in expected.items():
        require(run.get(key) == value, 'Run identity mismatch: ' + key)
    require(run.get('repository', {}).get('full_name') == REPOSITORY, 'Wrong repository')
    require(required_jobs and len(required_jobs) == len(set(required_jobs)), 'Empty or duplicate required jobs')
    for name in required_jobs:
        matches = [job for job in jobs if job.get('name') == name]
        require(len(matches) == 1, 'Missing or duplicate required job: ' + name)
        job = matches[0]
        require(job.get('run_id') == expected_run_id and job.get('status') == 'completed'
                and job.get('conclusion') == 'success', 'Required job did not succeed: ' + name)


def validate_artifact(metadata, archive_bytes, expected_id, expected_name, expected_run, expected_sha256):
    require(metadata.get('id') == expected_id and metadata.get('name') == expected_name,
            'Artifact identity mismatch')
    require(metadata.get('expired') is False, 'Artifact expired or expiry unknown')
    require(metadata.get('workflow_run', {}).get('id') == expected_run
            and metadata.get('workflow_run', {}).get('head_sha') == SOURCE,
            'Artifact producer mismatch')
    require(metadata.get('size_in_bytes') == len(archive_bytes), 'Archive size mismatch')
    digest = hashlib.sha256(archive_bytes).hexdigest()
    require(digest == expected_sha256 and metadata.get('digest') == 'sha256:' + digest,
            'Archive digest mismatch')


def validate_binary_zip(archive_bytes, expected):
    """Validate flat binary ZIP bytes without extracting any path."""
    require(bool(expected), 'Empty binary inventory')
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            infos = archive.infolist()
            require(len(infos) == len(expected), 'Binary inventory count mismatch')
            names = [info.filename for info in infos]
            require(len(names) == len(set(names)) and set(names) == set(expected),
                    'Binary inventory mismatch or duplicate')
            for info in infos:
                path = pathlib.PurePosixPath(info.filename)
                require(len(path.parts) == 1 and not path.is_absolute()
                        and info.filename not in ('.', '..') and '\\' not in info.filename,
                        'Unsafe archive path')
                mode = info.external_attr >> 16
                require(not info.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG)
                        and not info.flag_bits & 1, 'Non-regular or encrypted archive member')
                require(hashlib.sha256(archive.read(info)).hexdigest() == expected[info.filename],
                        'Binary digest mismatch')
    except (zipfile.BadZipFile, RuntimeError) as error:
        raise ValueError('Invalid binary archive') from error


def validate_registry(metadata, tarball, expected):
    """Compare registry bytes to canonical-verifier output, not a new manifest parser."""
    require(expected.get('version') == VERSION and expected.get('gitHead') == SOURCE,
            'Unpinned canonical package')
    for field in ('name', 'version', 'gitHead'):
        require(metadata.get(field) == expected.get(field) and bool(expected.get(field)),
                'Registry identity mismatch: ' + field)
    digest = hashlib.sha256(tarball).hexdigest()
    integrity = 'sha512-' + base64.b64encode(hashlib.sha512(tarball).digest()).decode('ascii')
    require(digest == expected.get('sha256') and integrity == expected.get('integrity')
            and metadata.get('dist', {}).get('integrity') == integrity, 'Registry byte mismatch')


def validate_provenance(statement, package_subject, sha512, run_id, attempt, workflow_path):
    """Check decoded SLSA v1 identities only. This does not verify signatures."""
    require(run_id == MAIN_RUN and attempt == 1
            and workflow_path == '.github/workflows/cicd.yml', 'Unpinned provenance invocation')
    require(statement.get('_type') == 'https://in-toto.io/Statement/v1'
            and statement.get('predicateType') == 'https://slsa.dev/provenance/v1', 'Wrong provenance format')
    require(statement.get('subject') == [{'name': package_subject, 'digest': {'sha512': sha512}}],
            'Provenance subject mismatch')
    predicate = statement.get('predicate', {})
    build = predicate.get('buildDefinition', {})
    require(build.get('buildType') == 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
            'Wrong provenance build type')
    require(build.get('externalParameters', {}).get('workflow') == {
        'repository': 'https://github.com/' + REPOSITORY,
        'ref': 'refs/heads/main', 'path': workflow_path}, 'Provenance workflow mismatch')
    dependencies = build.get('resolvedDependencies', [])
    require(any(item.get('uri') == 'git+https://github.com/' + REPOSITORY + '@refs/heads/main'
                and item.get('digest') == {'gitCommit': SOURCE} for item in dependencies),
            'Provenance source mismatch')
    details = predicate.get('runDetails', {})
    require(details.get('builder', {}).get('id') == 'https://github.com/actions/runner/github-hosted',
            'Provenance builder mismatch')
    require(details.get('metadata', {}).get('invocationId') ==
            'https://github.com/' + REPOSITORY + '/actions/runs/' + str(run_id) + '/attempts/' + str(attempt),
            'Provenance invocation mismatch')


def validate_registry_inventory(actual_names, canonical_names):
    """Require every canonical public package, including the root package."""
    require('veryfront' in canonical_names, 'Canonical root package missing')
    require(len(canonical_names) == len(set(canonical_names)), 'Duplicate canonical package')
    require(len(actual_names) == len(set(actual_names))
            and set(actual_names) == set(canonical_names), 'Registry package inventory mismatch')
