import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('prepared', Path(__file__).with_name('recover-release-prepared-1283.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class PreparedDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.rows = [{'name': f'asset-{i}.json', 'size': 4,
                      'sha256': hashlib.sha256(b'data').hexdigest()} for i in range(45)]
        self.raw = json.dumps({'schema_version': 1, 'version': r.publisher.VERSION,
                               'source_revision': r.publisher.SOURCE, 'assets': self.rows}).encode()
        self.manifest_hash = hashlib.sha256(self.raw).hexdigest()

    def archive(self, mutate=None):
        entries = [('manifest.json', self.raw)] + [('assets/' + row['name'], b'data') for row in self.rows]
        if mutate:
            mutate(entries)
        output = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(output, 'w') as archive:
                for name, data in entries:
                    archive.writestr(name, data)
        raw = output.getvalue()
        path = self.root / 'input.zip'
        path.write_bytes(raw)
        return path, hashlib.sha256(raw).hexdigest()

    def verify(self, mutate=None):
        path, digest = self.archive(mutate)
        return r.verify_archive(path, digest, self.manifest_hash, self.root / 'verified')

    def test_verifies_real_archive_bytes_and_manifest_before_loading_publisher(self):
        self.verify()
        self.assertEqual((self.root / 'verified/assets/asset-0.json').read_bytes(), b'data')
        self.assertEqual(len(list((self.root / 'verified/assets').iterdir())), 45)

    def test_rejects_traversal_extra_duplicate_and_symlink_before_extraction(self):
        def symlink(entries):
            info = zipfile.ZipInfo('assets/asset-0.json')
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            entries[1] = (info, b'data')
        for mutation in [lambda e: e.__setitem__(1, ('../outside', b'data')),
                         lambda e: e.append(('extra', b'data')),
                         lambda e: e.append(e[1]), symlink]:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.verify(mutation)
            self.assertFalse((self.root / 'verified').exists())
            self.assertFalse((self.root / 'outside').exists())

    def test_rejects_modified_archive_and_manifest_digest(self):
        path, digest = self.archive()
        for archive_hash, manifest_hash in [('0' * 64, self.manifest_hash), (digest, '0' * 64)]:
            with self.assertRaises(ValueError):
                r.verify_archive(path, archive_hash, manifest_hash, self.root / 'verified')
            self.assertFalse((self.root / 'verified').exists())

    def test_rejects_modified_inner_bytes(self):
        with self.assertRaises(ValueError):
            self.verify(lambda entries: entries.__setitem__(1, ('assets/asset-0.json', b'evil')))

    def test_extraction_target_enforces_resolved_containment(self):
        destination = self.root / 'verified'
        destination.mkdir()
        outside = self.root / 'outside'
        outside.mkdir()
        (destination / 'assets').symlink_to(outside, target_is_directory=True)
        for name in ('../outside/file', str(outside / 'file'), 'assets/file', '.'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                r.extraction_target(destination, name)
        self.assertEqual(r.extraction_target(destination, 'manifest.json'), destination.resolve() / 'manifest.json')
        self.assertEqual(list(outside.iterdir()), [])

    def test_preserves_existing_destination(self):
        destination = self.root / 'verified'
        destination.mkdir()
        (destination / 'preserved').write_text('keep')
        with self.assertRaises(ValueError):
            self.verify()
        self.assertEqual((destination / 'preserved').read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
