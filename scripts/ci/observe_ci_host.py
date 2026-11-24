"""Bounded host-memory and workspace-disk observations across CI action steps.

Adapted from the qualified observer at veryfront-job-runner commit
832ab46e64d304bb0bdaf6cf5c00143196d0cb35; the 45-minute bound matches
the native posture job. Callers enable this whole-host sampler only on
dedicated GitHub-hosted jobs, not shared runner pods.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


def sample(workspace):
    fields = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, _, value = line.partition(':')
        if key in ('MemTotal', 'MemAvailable'):
            amount, unit = value.split()
            if key in fields or unit != 'kB' or not amount.isdigit():
                raise ValueError('Invalid memory counter')
            fields[key] = int(amount) * 1024
    total, available = fields['MemTotal'], fields['MemAvailable']
    if not 0 <= available <= total or total <= 0:
        raise ValueError('Invalid memory bounds')
    return total, available, shutil.disk_usage(workspace).free


def observe(directory, workspace, reader=sample, interval=0.5, deadline=2700):
    started = time.monotonic()
    result = {'schema_version': 1, 'samples': 0, 'memory_total_bytes': None,
              'minimum_available_memory_bytes': None, 'minimum_free_disk_bytes': None,
              'interval_seconds': interval, 'logical_cpus': os.cpu_count(), 'error': None,
              'scope': 'Whole-host memory and workspace filesystem; sub-sample peaks may be missed.'}
    try:
        while True:
            total, available, disk = reader(workspace)
            if result['memory_total_bytes'] not in (None, total):
                raise ValueError('Host memory size changed')
            result['memory_total_bytes'] = total
            for key, value in [('minimum_available_memory_bytes', available), ('minimum_free_disk_bytes', disk)]:
                result[key] = value if result[key] is None else min(result[key], value)
            result['samples'] += 1
            if result['samples'] == 1:
                (directory / 'ready').touch(exist_ok=False)
            if (directory / 'stop').exists():
                break
            if time.monotonic() - started >= deadline:
                raise TimeoutError('Observation deadline exceeded')
            time.sleep(interval)
    except (OSError, ValueError, KeyError, TimeoutError) as error:
        result['error'] = type(error).__name__
    result['duration_seconds'] = round(time.monotonic() - started, 3)
    with (directory / 'report.tmp').open('x') as output:
        json.dump(result, output, indent=2)
    os.link(directory / 'report.tmp', directory / 'report.json')
    (directory / 'report.tmp').unlink()
    return result


def require_report(result):
    if result['error'] or result['samples'] < 2:
        raise ValueError('Missing or failed host observations')
    if result['minimum_available_memory_bytes'] < 512 * 1024**2:
        raise ValueError('Less than 512 MiB sampled memory headroom')
    if result['minimum_free_disk_bytes'] < 2 * 1024**3:
        raise ValueError('Less than 2 GiB sampled disk headroom')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['start', 'observe', 'finish'])
    args = parser.parse_args()
    runner_temp = Path(os.environ['RUNNER_TEMP'])
    if not runner_temp.is_absolute():
        raise ValueError('RUNNER_TEMP must be an absolute run-owned path')
    directory = runner_temp / 'posture-host-observation'
    if args.operation == 'observe':
        observe(directory, Path.cwd())
        return
    if args.operation == 'start':
        directory.mkdir(mode=0o700)  # Exclusive run-owned directory, never reuse source paths.
        with (directory / 'observer.log').open('x') as log:
            subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'observe'],
                             stdout=log, stderr=log, start_new_session=True)
        for _ in range(100):
            if (directory / 'ready').exists():
                return
            if (directory / 'report.json').exists():
                raise RuntimeError('Observer failed before readiness')
            time.sleep(0.1)
        (directory / 'stop').touch()
        raise TimeoutError('Observer did not become ready')
    (directory / 'stop').touch()
    for _ in range(100):
        if (directory / 'report.json').exists():
            result = json.loads((directory / 'report.json').read_text())
            print(json.dumps(result, sort_keys=True))
            require_report(result)
            return
        time.sleep(0.1)
    raise TimeoutError('Observer did not finish')


if __name__ == '__main__':
    main()
