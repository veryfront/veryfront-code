import importlib.util
import json
from pathlib import Path
import subprocess
import unittest


def load():
    spec = importlib.util.spec_from_file_location('recover_tags', Path(__file__).with_name('recover-release-tags-1283.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class RecoveryTagTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.present = False
        self.target = 'f8ac0969c8d874b7c3a891cf007a8a3351fa7011'
        self.kind = 'commit'
        self.readback = None

    def transport(self, args):
        self.calls.append(args)
        if 'POST' in args:
            self.present = True
            return b'{}'
        if '/git/commits/' in args[-1]:
            return json.dumps({'sha': self.target}).encode()
        if not self.present:
            raise subprocess.CalledProcessError(1, args, output=b'{"status":"404","message":"Not Found"}')
        return json.dumps({'ref': 'refs/tags/v0.1.1283',
                           'object': {'type': self.kind, 'sha': self.readback or self.target}}).encode()

    def test_exact_release_query_rejects_errors_and_malformed_identity(self):
        find = load().find_release
        row = {'databaseId': 7, 'tagName': 'v0.1.1283', 'isDraft': True, 'isPrerelease': False}
        for response in ({'errors': [{'message': 'denied'}], 'data': {'repository': {'release': None}}},
                         {'data': {'repository': None}}, {'data': {'repository': {}}},
                         {'data': {'repository': {'release': dict(row, databaseId=True)}}},
                         {'data': {'repository': {'release': dict(row, tagName='other')}}}):
            calls = []
            def query(args):
                calls.append(args)
                return json.dumps(response).encode()
            with self.assertRaises(ValueError):
                find('veryfront/veryfront', query)
            self.assertEqual(len(calls), 1)

    def test_exact_draft_query_requires_matching_rest_readback(self):
        find = load().find_release
        row = {'id': 7, 'tag_name': 'v0.1.1283', 'draft': True, 'prerelease': False}
        queried = {'databaseId': 7, 'tagName': 'v0.1.1283', 'isDraft': True, 'isPrerelease': False}
        def transport(args):
            if args[:2] == ['api', 'graphql']:
                return json.dumps({'data': {'repository': {'release': queried}}}).encode()
            self.assertEqual(args[-1], 'repos/veryfront/veryfront/releases/7')
            return json.dumps(row).encode()
        self.assertEqual(find('veryfront/veryfront', transport), row)
        for change in ({'id': 8}, {'tag_name': 'other'}, {'draft': False}, {'prerelease': True}):
            original = dict(row)
            row.update(change)
            with self.assertRaises(ValueError):
                find('veryfront/veryfront', transport)
            row.clear()
            row.update(original)

    def test_creates_absent_and_reads_back_exact_commit(self):
        result = load().recover('veryfront/veryfront', self.transport)
        self.assertEqual(result['object']['sha'], self.target)
        writes = [args for args in self.calls if 'POST' in args]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][-1], 'repos/veryfront/veryfront/git/refs')
        self.assertIn('ref=refs/tags/v0.1.1283', writes[0])
        self.assertIn('sha=' + self.target, writes[0])
        self.assertIn('/git/ref/tags/v0.1.1283', self.calls[-1][-1])

    def test_existing_exact_ref_is_read_only_for_both_repositories(self):
        for repo, target in [('veryfront/veryfront', self.target),
                             ('veryfront/veryfront-code', '8b9eb53979953e4a934014232982cca02eff63b0')]:
            self.calls = []
            self.present = True
            self.target = target
            load().recover(repo, self.transport)
            self.assertTrue(all('GET' in args or args[:2] == ['api', 'graphql'] for args in self.calls))

    def test_wrong_ref_target_or_annotated_tag_never_mutates(self):
        recover = load().recover
        self.present = True
        for kind, target in [('tag', self.target), ('commit', '0' * 40)]:
            self.kind, self.readback = kind, target
            with self.assertRaises(ValueError): recover('veryfront/veryfront', self.transport)
        self.assertTrue(all('GET' in args or args[:2] == ['api', 'graphql'] for args in self.calls))

    def test_auth_network_and_malformed_404_do_not_create(self):
        recover = load().recover
        for output in [b'{"status":"403"}', b'network error', b'{"status":"404","message":"other"}']:
            self.calls = []
            def failing(args):
                self.calls.append(args)
                if '/git/commits/' in args[-1]: return json.dumps({'sha': self.target}).encode()
                raise subprocess.CalledProcessError(1, args, output=output)
            with self.assertRaises(subprocess.CalledProcessError):
                recover('veryfront/veryfront', failing)
            self.assertTrue(all('GET' in args or args[:2] == ['api', 'graphql'] for args in self.calls))

    def test_absent_target_commit_never_attempts_ref(self):
        recover = load().recover
        def absent(args):
            self.calls.append(args)
            raise subprocess.CalledProcessError(1, args, output=b'{"status":"404","message":"Not Found"}')
        with self.assertRaises(subprocess.CalledProcessError): recover('veryfront/veryfront', absent)
        self.assertEqual(len(self.calls), 1)

    def test_wrong_target_commit_or_repository_refused_before_write(self):
        recover = load().recover
        self.target = '0' * 40
        with self.assertRaises(ValueError): recover('veryfront/veryfront', self.transport)
        self.assertEqual(len(self.calls), 1)
        self.calls = []
        with self.assertRaises(ValueError): recover('other/repo', self.transport)
        self.assertEqual(self.calls, [])

    def test_readback_mismatch_and_create_conflict_are_not_retried_or_forced(self):
        recover = load().recover
        original = self.transport
        def mismatch(args):
            result = original(args)
            if 'POST' in args: self.readback = '0' * 40
            return result
        with self.assertRaises(ValueError): recover('veryfront/veryfront', mismatch)
        self.assertEqual(sum('POST' in args for args in self.calls), 1)
        self.calls = []
        self.present = False
        def conflict(args):
            if 'POST' in args:
                self.calls.append(args)
                raise subprocess.CalledProcessError(1, args, output=b'{"status":"422"}')
            return original(args)
        with self.assertRaises(subprocess.CalledProcessError): recover('veryfront/veryfront', conflict)
        self.assertEqual(sum('POST' in args for args in self.calls), 1)
        self.assertFalse(any('PATCH' in args or 'DELETE' in args for args in self.calls))

    def source_transport(self, rows):
        self.target = '8b9eb53979953e4a934014232982cca02eff63b0'
        self.present = True
        original = self.transport
        def transport(args):
            if args[:2] == ['api', 'graphql']:
                self.calls.append(args)
                row = next((row for row in rows if row.get('tag_name') == 'v0.1.1283'), None)
                value = None if row is None else {'databaseId': row['id'], 'tagName': row['tag_name'],
                    'isDraft': row['draft'], 'isPrerelease': row['prerelease']}
                return json.dumps({'data': {'repository': {'release': value}}}).encode()
            if '/releases' in args[-1] or args[:2] == ['release', 'create']:
                self.calls.append(args)
                if args[:2] == ['release', 'create']:
                    self.assertIn('--verify-tag', args)
                    self.assertIn('--latest=false', args)
                    self.assertNotIn('--target', args)
                    self.assertFalse(any(arg.endswith('.tgz') for arg in args))
                    rows.append({'id': 3, 'tag_name': 'v0.1.1283', 'target_commitish': 'main',
                                 'draft': False, 'prerelease': False})
                    return b''
                if '/releases?' in args[-1]: return json.dumps(rows).encode()
                return json.dumps(rows[0]).encode()
            return original(args)
        return transport

    def test_optional_source_release_creates_missing_only_without_assets(self):
        rows = []
        load().recover('veryfront/veryfront-code', self.source_transport(rows), source_release=True)
        self.assertEqual(sum(args[:2] == ['release', 'create'] for args in self.calls), 1)
        self.calls = []
        load().recover('veryfront/veryfront-code', self.source_transport(rows), source_release=True)
        self.assertTrue(all('GET' in args or args[:2] == ['api', 'graphql'] for args in self.calls))

    def test_source_tag_readback_after_release_rejects_concurrent_change(self):
        recover = load().recover
        original = self.source_transport([])
        def changed(args):
            result = original(args)
            if args[:2] == ['release', 'create']:
                self.readback = '0' * 40
            return result
        with self.assertRaises(ValueError):
            recover('veryfront/veryfront-code', changed, source_release=True)
        self.assertIn('/git/ref/tags/v0.1.1283', self.calls[-1][-1])
        self.assertFalse(any('PATCH' in args or 'DELETE' in args for args in self.calls))

    def test_optional_source_release_rejects_draft_prerelease_and_query_failure(self):
        recover = load().recover
        correct = {'id': 3, 'tag_name': 'v0.1.1283', 'target_commitish': '8b9eb53979953e4a934014232982cca02eff63b0',
                   'draft': False, 'prerelease': False}
        for rows in [[dict(correct, prerelease=True)], [dict(correct, draft=True)]]:
            self.calls = []
            transport = self.source_transport(rows)
            with self.assertRaises(ValueError):
                recover('veryfront/veryfront-code', transport, source_release=True)
            self.assertTrue(all('GET' in args or args[:2] == ['api', 'graphql'] for args in self.calls))
        self.calls = []
        original = self.source_transport([])
        def failed(args):
            if args[:2] == ['api', 'graphql']:
                self.calls.append(args)
                raise subprocess.CalledProcessError(1, args, output=b'{"status":"403"}')
            return original(args)
        with self.assertRaises(subprocess.CalledProcessError):
            recover('veryfront/veryfront-code', failed, source_release=True)
        self.assertTrue(all('GET' in args or args[:2] == ['api', 'graphql'] for args in self.calls))
        self.calls = []
        with self.assertRaises(ValueError):
            recover('veryfront/veryfront', self.transport, source_release=True)
        self.assertEqual(self.calls, [])


if __name__ == '__main__': unittest.main()
