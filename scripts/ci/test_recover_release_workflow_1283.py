"""Guard recovery authority boundaries in the checked-in workflow."""
from pathlib import Path
import unittest


class WorkflowBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.text = (Path(__file__).resolve().parents[2] / '.github/workflows/recover-release-1283.yml').read_text()

    def test_dispatch_is_main_only_and_serial(self):
        self.assertIn("github.ref == 'refs/heads/main'", self.text)
        self.assertIn("github.repository == 'veryfront/veryfront-code'", self.text)
        self.assertIn('cancel-in-progress: false', self.text)

    def test_public_write_token_follows_fresh_runner_authentication(self):
        publish = self.text.split('\n  publish:', 1)[1].split('\n  source-tag:', 1)[0]
        self.assertLess(publish.index('recover-release-prepared-1283.py'), publish.index('actions/create-github-app-token@'))
        self.assertIn('needs.prepare.outputs.archive_sha256', publish)
        self.assertIn('needs.prepare.outputs.manifest_sha256', publish)
        self.assertNotIn('contents: write', publish.split('    steps:', 1)[0])
        self.assertIn('repositories: veryfront\n', publish)

    def test_only_assets_and_manifest_cross_runner_boundary(self):
        upload = self.text.split('id: upload', 1)[1].split('\n  publish:', 1)[0]
        self.assertIn('/prepared/manifest.json', upload)
        self.assertIn('/prepared/assets/*', upload)
        self.assertNotIn('/prepared/**', upload)

    def test_source_write_requires_successful_publication(self):
        source = self.text.split('\n  source-tag:', 1)[1]
        self.assertIn('needs: publish', source)
        self.assertIn('contents: write', source)
        self.assertNotIn('if: always()', source)
        self.assertIn('--repository veryfront/veryfront-code --source-release', source)


if __name__ == '__main__':
    unittest.main()
