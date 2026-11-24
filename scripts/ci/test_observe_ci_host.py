import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('observer', Path(__file__).with_name('observe_ci_host.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class HostObservationTests(unittest.TestCase):
    def test_sampler_uses_available_memory_and_the_workspace_filesystem(self):
        data = 'MemTotal: 8388608 kB\nMemFree: 1 kB\nMemAvailable: 3145728 kB\n'
        workspace = Path('workspace')
        with patch.object(observer.Path, 'read_text', return_value=data), \
                patch.object(observer.shutil, 'disk_usage', return_value=SimpleNamespace(free=9*1024**3)) as disk:
            self.assertEqual(observer.sample(workspace), (8*1024**3, 3*1024**3, 9*1024**3))
        disk.assert_called_once_with(workspace)

    def test_cli_reports_failed_start_before_admitting_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'posture-host-observation'
            def launch(*args, **options):
                (root / 'report.json').write_text(json.dumps({'error': 'OSError'}))
            with patch.object(observer.subprocess, 'Popen', side_effect=launch), \
                    patch.dict(os.environ, {'RUNNER_TEMP': directory}), \
                    patch.object(observer.sys, 'argv', ['observer', 'start']), \
                    self.assertRaises(RuntimeError):
                observer.main()

    def test_user_arguments_cannot_reach_the_child_process(self):
        with patch.object(observer.sys, 'argv', ['observer', 'start', '--directory=/tmp/other']), \
                patch.object(observer.subprocess, 'Popen') as launch, \
                patch.object(observer.sys, 'stderr', io.StringIO()), self.assertRaises(SystemExit) as error:
            observer.main()
        self.assertEqual(error.exception.code, 2)
        launch.assert_not_called()

    def test_relative_temporary_directory_fails_before_launch(self):
        with patch.dict(os.environ, {'RUNNER_TEMP': 'relative'}), \
                patch.object(observer.sys, 'argv', ['observer', 'start']), \
                patch.object(observer.subprocess, 'Popen') as launch, self.assertRaises(ValueError):
            observer.main()
        launch.assert_not_called()

    def test_cli_finish_requires_the_observer_to_publish_a_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'posture-host-observation'
            root.mkdir()
            with patch.object(observer.time, 'sleep'), \
                    patch.dict(os.environ, {'RUNNER_TEMP': directory}), \
                    patch.object(observer.sys, 'argv', ['observer', 'finish']), \
                    self.assertRaises(TimeoutError):
                observer.main()
            self.assertTrue((root / 'stop').exists())

    def test_cli_owns_new_state_and_finishes_only_a_complete_report(self):
        valid = {'error': None, 'samples': 2, 'minimum_available_memory_bytes': 1024**3,
                 'minimum_free_disk_bytes': 3*1024**3}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'posture-host-observation'
            def launch(command, **options):
                self.assertEqual(command[2:], ['observe'])
                self.assertTrue(options['start_new_session'])
                with patch.object(observer.sys, 'argv', command[1:]), \
                        patch.object(observer, 'observe') as collect:
                    observer.main()
                    collect.assert_called_once_with(root, Path.cwd())
                (root / 'ready').touch()
            with patch.object(observer.subprocess, 'Popen', side_effect=launch), \
                    patch.dict(os.environ, {'RUNNER_TEMP': directory}), \
                    patch.object(observer.sys, 'argv', ['observer', 'start']):
                observer.main()
                with self.assertRaises(FileExistsError):observer.main()
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
            (root / 'report.json').write_text(json.dumps(valid))
            output = io.StringIO()
            with patch.dict(os.environ, {'RUNNER_TEMP': directory}), \
                    patch.object(observer.sys, 'argv', ['observer', 'finish']), \
                    patch.object(observer.sys, 'stdout', output):
                observer.main()
            self.assertTrue((root / 'stop').exists())
            self.assertEqual(json.loads(output.getvalue()), valid)

    def test_cli_start_failure_requests_stop_instead_of_leaving_an_unbounded_observer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'posture-host-observation'
            with patch.object(observer.subprocess, 'Popen'), \
                    patch.object(observer.time, 'sleep'), \
                    patch.dict(os.environ, {'RUNNER_TEMP': directory}), \
                    patch.object(observer.sys, 'argv', ['observer', 'start']), \
                    self.assertRaises(TimeoutError):
                observer.main()
            self.assertTrue((root / 'stop').exists())

    def test_cli_finish_does_not_accept_a_failed_sample_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'posture-host-observation'
            root.mkdir()
            (root / 'report.json').write_text(json.dumps({'error': 'OSError', 'samples': 1}))
            with patch.dict(os.environ, {'RUNNER_TEMP': directory}), \
                    patch.object(observer.sys, 'argv', ['observer', 'finish']), \
                    patch.object(observer.sys, 'stdout', io.StringIO()), self.assertRaises(ValueError):
                observer.main()

    def test_sampler_rejects_invalid_bounds_instead_of_inventing_headroom(self):
        for data in ('MemTotal: 1024 kB\nMemAvailable: 2048 kB\n',
                     'MemTotal: 1024 bytes\nMemAvailable: 512 kB\n'):
            with self.subTest(data=data), patch.object(observer.Path, 'read_text', return_value=data), \
                    self.assertRaises(ValueError):
                observer.sample(Path('.'))

    def test_minima_are_retained_and_report_is_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            samples = iter([(8*1024**3, 3*1024**3, 9*1024**3), (8*1024**3, 1024**3, 3*1024**3)])
            def read(_):
                value = next(samples)
                if value[1] == 1024**3:
                    (root / 'stop').touch()
                return value
            result = observer.observe(root, root, reader=read, interval=0)
            observer.require_report(result)
            self.assertEqual(result['samples'], 2)
            self.assertEqual(result['minimum_available_memory_bytes'], 1024**3)
            self.assertEqual(result['minimum_free_disk_bytes'], 3*1024**3)
            self.assertEqual(json.loads((root / 'report.json').read_text()), result)
            self.assertFalse((root / 'report.tmp').exists())

    def test_sampling_errors_and_deadline_fail_closed(self):
        for reader, deadline in [(lambda _: (_ for _ in ()).throw(OSError()), 10),
                                 (lambda _: (8*1024**3, 1024**3, 3*1024**3), 0)]:
            with self.subTest(deadline=deadline), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result = observer.observe(root, root, reader=reader, deadline=deadline)
                with self.assertRaises(ValueError):
                    observer.require_report(result)
                self.assertIsNotNone(result['error'])

    def test_missing_samples_memory_and_disk_fail_closed(self):
        valid = {'error': None, 'samples': 2, 'minimum_available_memory_bytes': 1024**3,
                 'minimum_free_disk_bytes': 3*1024**3}
        observer.require_report(valid)
        for key, value in [('samples', 1), ('minimum_available_memory_bytes', 511*1024**2),
                           ('minimum_free_disk_bytes', 2*1024**3-1), ('error', 'OSError')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                observer.require_report({**valid, key: value})
