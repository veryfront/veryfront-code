"""Read-only readiness observation. Never a release qualification or publisher."""
import datetime
import importlib.util
import json
import pathlib
import subprocess
import sys
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery_verifier', HERE / 'recover-release-1283.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def gh_json(path):
    process = subprocess.run(['gh', 'api', path], check=True, capture_output=True, text=True, timeout=45)
    return json.loads(process.stdout)


def registry_json(url):
    request = urllib.request.Request(url, headers={'Accept':'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            verifier.require(response.url == url, 'Registry redirected metadata request')
            data = response.read(4 * 1024 * 1024 + 1)
            verifier.require(len(data) <= 4 * 1024 * 1024, 'Registry metadata exceeds bound')
            return json.loads(data)
    except Exception as error:
        raise ValueError('Root registry metadata unavailable: ' + type(error).__name__) from error


def check_root(fetch=registry_json):
    metadata = fetch('https://registry.npmjs.org/veryfront/0.1.1283')
    for key, value in {'name':'veryfront','version':verifier.VERSION,'gitHead':verifier.SOURCE}.items():
        verifier.require(metadata.get(key) == value, 'Root metadata mismatch: ' + key)
    dist = metadata.get('dist', {})
    verifier.require(dist.get('tarball') == 'https://registry.npmjs.org/veryfront/-/veryfront-0.1.1283.tgz',
                     'Root tarball URL mismatch')
    verifier.require(isinstance(dist.get('integrity'), str) and dist['integrity'].startswith('sha512-'),
                     'Root integrity missing')
    return {'status':'metadata-available-unqualified', 'tarballBytesVerified':False,
            'signaturesVerified':False}


def read_jobs(prefix, run_id, github):
    jobs = {'jobs': [], 'total_count': None}
    for page in range(1, 11):
        batch = github(prefix + 'actions/runs/' + str(run_id) + '/attempts/1/jobs?per_page=100&page=' + str(page))
        if jobs['total_count'] is None:
            jobs['total_count'] = batch.get('total_count')
        verifier.require(batch.get('total_count') == jobs['total_count'], 'Jobs changed during pagination')
        jobs['jobs'].extend(batch.get('jobs', []))
        if len(jobs['jobs']) == jobs['total_count']:
            break
        verifier.require(bool(batch.get('jobs')), 'Incomplete jobs response')
    verifier.require(jobs['total_count'] == len(jobs['jobs']), 'Jobs exceed bounded pagination')
    return jobs


def check_producer(plan, key, prefix, github):
    run_id = plan[key + 'Run']
    run = github(prefix + 'actions/runs/' + str(run_id) + '/attempts/1')
    jobs = read_jobs(prefix, run_id, github)
    names = plan['mainRequiredJobs'] if key == 'main' else ['npm compatibility artifact', 'quality gate (merge)']
    verifier.validate_run(run, run_id, plan[key+'Event'], plan[key+'Ref'], plan['workflowPath'], names, jobs['jobs'])
    if key == 'testedNpm':
        verifier.require(run.get('conclusion') == 'success', 'Tested merge-group run did not succeed')


def check_artifacts(plan, prefix, github):
    for expected in plan['binaryArtifacts']:
        item = github(prefix + 'actions/artifacts/' + str(expected['id']))
        verifier.require(all(item.get(k) == expected[k] for k in ('id','name','digest','size_in_bytes')),
                         'Pinned artifact metadata mismatch')
        verifier.require(item.get('expired') is False and item.get('workflow_run', {}).get('id') == verifier.MAIN_RUN
                         and item.get('workflow_run', {}).get('head_sha') == verifier.SOURCE,
                         'Pinned artifact producer mismatch or expired')
    item = github(prefix + 'actions/artifacts/' + str(plan['npmArtifact']['id']))
    verifier.require(item.get('id') == plan['npmArtifact']['id']
                     and item.get('name') == plan['npmArtifact']['name']
                     and item.get('size_in_bytes') == plan['npmArtifact']['size_in_bytes']
                     and item.get('digest') == 'sha256:' + plan['npmArtifact']['sha256']
                     and item.get('expired') is False and item.get('workflow_run', {}).get('id') == verifier.TESTED_RUN
                     and item.get('workflow_run', {}).get('head_sha') == verifier.SOURCE,
                     'Pinned npm artifact metadata mismatch')


def observe(plan, github=gh_json, registry=registry_json):
    report = {'schemaVersion':1,'scope':'original-1283-readiness-only',
              'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'readyForFullQualification':False,'releaseQualified':False,
              'signatureVerificationPerformed':False,'observations':[],'failures':[]}
    prefix = 'repos/' + verifier.REPOSITORY + '/'
    for key in ('testedNpm', 'main'):
        try:
            check_producer(plan, key, prefix, github)
            report['observations'].append({'producer':key,'identityAndRequiredJobs':'passed'})
        except Exception as error:
            report['failures'].append({'producer':key,'reason':str(error) if isinstance(error, ValueError) else type(error).__name__})
    try:
        check_artifacts(plan, prefix, github)
        report['observations'].append({'artifacts':'metadata-passed-bytes-not-downloaded'})
    except Exception as error:
        report['failures'].append({'artifacts':str(error) if isinstance(error, ValueError) else type(error).__name__})
    try:
        report['rootPackage'] = check_root(registry)
    except Exception as error:
        report['failures'].append({'rootPackage':str(error) if isinstance(error, ValueError) else type(error).__name__})
    report['readyForFullQualification'] = not report['failures']
    return report


def main():
    plan = json.loads((HERE / 'recover-release-1283.json').read_text())
    result = observe(plan)
    print(json.dumps(result, indent=2))
    return 0 if result['readyForFullQualification'] else 1


if __name__ == '__main__':
    sys.exit(main())
