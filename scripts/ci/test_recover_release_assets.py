import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

PATH = Path(__file__).with_name('recover-release-assets.py')


def module():
    spec = importlib.util.spec_from_file_location('recover_release_assets', PATH)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def uploading(args):
    return args[0] == 'api' and 'POST' in args


def publishing(args):
    return args[0] == 'api' and 'PATCH' in args


class RecoveryAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        (self.directory / 'binary').write_bytes(b'original')
        self.row = {'name': 'binary', 'size': 8, 'sha256': hashlib.sha256(b'original').hexdigest()}
        self.manifest = {'schema_version': 1, 'version': '0.1.1283',
                         'source_revision': '8b9eb53979953e4a934014232982cca02eff63b0', 'assets': [self.row]}
        self.manifest_path = self.directory / 'manifest.json'
        self.write_manifest()
        self.calls = []
        self.release = {'id': 7, 'tag_name': 'v0.1.1283', 'draft': True, 'prerelease': False}
        self.assets = []

    def write_manifest(self):
        raw = json.dumps(self.manifest).encode()
        self.manifest_path.write_bytes(raw)
        self.digest = hashlib.sha256(raw).hexdigest()

    def uploaded(self):
        return {'id': 9, 'name': 'binary', 'size': 8, 'state': 'uploaded', 'digest': 'sha256:' + self.row['sha256']}

    def transport(self, args):
        self.calls.append(args)
        if uploading(args):
            self.assets.append(self.uploaded())
        elif publishing(args):
            self.release['draft'] = False
        elif args[0] == 'api':
            if '/assets?' in args[-1]:
                return json.dumps(self.assets).encode()
            if '/releases?' in args[-1]:
                return json.dumps([self.release]).encode()
            if '/releases/' in args[-1]:
                return json.dumps(self.release).encode()
            raise AssertionError(args)
        else:
            raise AssertionError(args)
        return b''

    def run_recovery(self):
        return module().recover(self.manifest_path, self.digest, self.directory, self.transport)

    def test_authenticated_list_finds_draft_when_tag_endpoint_returns_404(self):
        original = self.transport
        def realistic(args):
            if args[0] == 'api' and '/releases/tags/' in args[-1]:
                raise subprocess.CalledProcessError(1, args, output=b'{"status":"404"}')
            if args[0] == 'api' and '/releases?' in args[-1]:
                self.calls.append(args)
                return json.dumps([self.release]).encode()
            return original(args)
        self.assets = [self.uploaded()]
        module().recover(self.manifest_path, self.digest, self.directory, realistic)
        self.assertFalse(any(a[:2] == ['release', 'create'] for a in self.calls))

    def test_uploads_missing_once_then_verifies_before_publication(self):
        result = self.run_recovery()
        self.assertFalse(result['draft'])
        upload = [a for a in self.calls if uploading(a)]
        self.assertEqual(len(upload), 1)
        self.assertNotIn('--clobber', upload[0])
        self.assertNotIn('--hostname', upload[0])
        self.assertEqual(upload[0][-1], 'https://uploads.github.com/repos/veryfront/veryfront/releases/7/assets?name=binary')
        self.assertIn('make_latest=false', next(a for a in self.calls if publishing(a)))
        self.assertTrue(any('/assets?' in a[-1] for a in self.calls[self.calls.index(upload[0]) + 1:]))

    def test_preserves_uploaded_and_identical_published_release(self):
        self.assets = [self.uploaded()]
        self.release['draft'] = False
        self.run_recovery()
        self.assertTrue(all(not uploading(a) and not publishing(a) for a in self.calls))

    def test_preserves_uploaded_draft_asset(self):
        self.assets = [self.uploaded()]
        self.run_recovery()
        self.assertFalse(any(uploading(a) for a in self.calls))

    def test_rejects_extra_duplicate_mismatched_or_incomplete_assets_before_writes(self):
        for assets in [[self.uploaded(), self.uploaded()],
                       [dict(self.uploaded(), name='unexpected')],
                       [dict(self.uploaded(), digest='sha256:' + '0' * 64)],
                       [dict(self.uploaded(), size=9)],
                       [dict(self.uploaded(), state='starter')]]:
            with self.subTest(assets=assets):
                self.calls = []
                self.assets = assets
                with self.assertRaises(ValueError): self.run_recovery()
                self.assertTrue(all(not uploading(a) and not publishing(a) for a in self.calls))

    def test_rejects_wrong_manifest_hash_source_version_or_unsafe_paths(self):
        for change in [{'version': '0.1.1284'}, {'source_revision': '0' * 40},
                       {'assets': [dict(self.row, name='../binary')]}]:
            with self.subTest(change=change):
                original = self.manifest.copy()
                self.manifest.update(change)
                self.write_manifest()
                with self.assertRaises(ValueError): self.run_recovery()
                self.assertEqual(self.calls, [])
                self.manifest = original
        self.write_manifest()
        self.digest = '0' * 64
        with self.assertRaises(ValueError): self.run_recovery()
        self.assertEqual(self.calls, [])

    def test_rejects_local_corruption_and_symlink(self):
        (self.directory / 'binary').write_bytes(b'corrupted')
        with self.assertRaises(ValueError): self.run_recovery()
        (self.directory / 'binary').unlink()
        (self.directory / 'target').write_bytes(b'original')
        (self.directory / 'binary').symlink_to('target')
        with self.assertRaises(ValueError): self.run_recovery()
        self.assertEqual(self.calls, [])

    def test_creates_only_after_complete_empty_list_and_rejects_auth_failure(self):
        original = self.transport
        missing = True
        def absent(args):
            nonlocal missing
            if args[0] == 'api' and '/releases?' in args[-1] and missing:
                missing = False
                self.calls.append(args)
                return b'[]'
            if args[:2] == ['release', 'create']:
                self.calls.append(args)
                self.assertIn('--draft', args)
                self.assertIn('--verify-tag', args)
                return b''
            return original(args)
        module().recover(self.manifest_path, self.digest, self.directory, absent)
        self.assertEqual(sum(a[:2] == ['release', 'create'] for a in self.calls), 1)
        self.calls = []
        def denied(args):
            self.calls.append(args)
            raise subprocess.CalledProcessError(1, args, output=b'{"status":"403"}')
        recover = module().recover
        with self.assertRaises(subprocess.CalledProcessError):
            recover(self.manifest_path, self.digest, self.directory, denied)
        self.assertEqual(len(self.calls), 1)

    def test_absent_public_tag_failure_does_not_upload_or_publish(self):
        def missing_tag(args):
            self.calls.append(args)
            if args[0] == 'api':
                return b'[]'
            self.assertEqual(args[:2], ['release', 'create'])
            self.assertIn('--verify-tag', args)
            raise subprocess.CalledProcessError(1, args, output=b'tag does not exist')
        recover = module().recover
        with self.assertRaises(subprocess.CalledProcessError):
            recover(self.manifest_path, self.digest, self.directory, missing_tag)
        self.assertEqual(len(self.calls), 2)
        self.assertFalse(any((uploading(a) or publishing(a)) for a in self.calls))

    def test_missing_final_upload_never_publishes(self):
        original = self.transport
        def lost(args):
            if uploading(args):
                self.calls.append(args)
                return b''
            return original(args)
        recover = module().recover
        with self.assertRaises(ValueError):
            recover(self.manifest_path, self.digest, self.directory, lost)
        self.assertFalse(any(publishing(a) for a in self.calls))

    def test_upload_failure_does_not_delete_or_publish(self):
        original = self.transport
        def failing(args):
            if uploading(args):
                self.calls.append(args)
                raise subprocess.CalledProcessError(1, args)
            return original(args)
        recover = module().recover
        with self.assertRaises(subprocess.CalledProcessError):
            recover(self.manifest_path, self.digest, self.directory, failing)
        self.assertFalse(any(publishing(a) or 'DELETE' in a for a in self.calls))

    def test_published_missing_assets_and_wrong_release_fail_closed(self):
        self.release['draft'] = False
        with self.assertRaises(ValueError): self.run_recovery()
        self.release['draft'] = True
        original = self.transport
        def wrong(args):
            if args[0] == 'api' and args[-1].endswith('/releases/7'):
                self.calls.append(args)
                return json.dumps(dict(self.release, tag_name='v0.1.1263')).encode()
            return original(args)
        recover = module().recover
        with self.assertRaises(ValueError):
            recover(self.manifest_path, self.digest, self.directory, wrong)
        self.assertTrue(all(not uploading(a) and not publishing(a) for a in self.calls))

    def test_duplicate_tags_or_incomplete_bounded_listing_never_create(self):
        for rows in [[self.release, dict(self.release, id=8)],
                     [{'tag_name': 'another'}] * 100]:
            self.calls = []
            def listed(args):
                self.calls.append(args)
                return json.dumps(rows).encode()
            recover = module().recover
            with self.assertRaises(ValueError):
                recover(self.manifest_path, self.digest, self.directory, listed)
            self.assertTrue(all(a[0] == 'api' and 'GET' in a for a in self.calls))

    def test_list_404_is_not_absence_and_never_creates(self):
        def unavailable(args):
            self.calls.append(args)
            raise subprocess.CalledProcessError(1, args, output=b'{"status":"404"}')
        recover = module().recover
        with self.assertRaises(subprocess.CalledProcessError):
            recover(self.manifest_path, self.digest, self.directory, unavailable)
        self.assertEqual(len(self.calls), 1)



if __name__ == '__main__': unittest.main()


class ManifestLocationTests(unittest.TestCase):
    def test_rejects_outside_manifest_before_reading(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            assets = root / 'assets'
            assets.mkdir()
            outside = root / 'unrelated.json'
            outside.write_text('not release data')
            load_manifest = module().load_manifest
            with self.assertRaisesRegex(ValueError, 'Manifest must belong'):
                load_manifest(outside, '0' * 64, assets)

    def test_rejects_manifest_symlink_before_reading(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            assets = root / 'assets'
            assets.mkdir()
            unrelated = root / 'unrelated.json'
            unrelated.write_text('not release data')
            manifest = root / 'manifest.json'
            manifest.symlink_to(unrelated)
            load_manifest = module().load_manifest
            with self.assertRaisesRegex(ValueError, 'Manifest cannot be a symlink'):
                load_manifest(manifest, '0' * 64, assets)


if __name__ == '__main__':
    unittest.main()
