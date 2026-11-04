import importlib.util
import hashlib
import io
import pathlib
import stat
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('prepare',pathlib.Path(__file__).with_name('prepare-release-1283.py'))
p=importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class PreparationTests(unittest.TestCase):
    def zip(self,entries):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as archive:
            for name,value in entries:archive.writestr(name,value)
        return out.getvalue()

    def test_safe_flat_extraction_rejects_escape_symlink_duplicates_and_extras(self):
        for entries in [[('../payload',b'x')],[('payload',b'x'),('extra',b'x')],[('payload',b'x')]*2]:
            with tempfile.TemporaryDirectory() as d:
                archive=pathlib.Path(d)/'input.zip';archive.write_bytes(self.zip(entries))
                with self.assertRaises(ValueError):p.extract_flat(archive,pathlib.Path(d)/'out',{'payload'})
        link=zipfile.ZipInfo('payload');link.create_system=3;link.external_attr=(stat.S_IFLNK|0o777)<<16
        with tempfile.TemporaryDirectory() as d:
            archive=pathlib.Path(d)/'input.zip';archive.write_bytes(self.zip([(link,b'target')]))
            with self.assertRaises(ValueError):p.extract_flat(archive,pathlib.Path(d)/'out',{'payload'})

    def test_correct_extraction_and_existing_target_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            archive=pathlib.Path(d)/'input.zip';archive.write_bytes(self.zip([('payload',b'actual')]))
            target=pathlib.Path(d)/'out';p.extract_flat(archive,target,{'payload'})
            self.assertEqual((target/'payload').read_bytes(),b'actual')
            with self.assertRaises(ValueError):p.extract_flat(archive,target,{'payload'})

    def test_signature_audit_requires_verified_bundle_for_every_expected_package(self):
        expected=['veryfront','@veryfront/ext-example']
        good={'invalid':[],'missing':[],'verified':[{'name':name,'version':p.VERSION,'attestations':{'verified':True},'attestationBundles':[{'bundle':'verified-by-npm'}]} for name in expected]}
        self.assertEqual(len(p.validate_signature_audit(good,expected)),2)
        for invalid in [{}, {'invalid':[],'missing':[]}, {**good,'verified':good['verified'][:1]}, {**good,'invalid':[{'name':'veryfront'}]}, {**good,'missing':[{'name':'veryfront'}]}]:
            with self.assertRaises(ValueError):p.validate_signature_audit(invalid,expected)
        for field in ['attestations','attestationBundles']:
            bad={'invalid':[],'missing':[],'verified':[{**x,field:[]} for x in good['verified']]}
            with self.assertRaises(ValueError):p.validate_signature_audit(bad,expected)

    def test_staged_binary_moves_without_retaining_duplicate_materials(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);archive=root/'input.zip';archive.write_bytes(self.zip([('payload',b'actual-binary')]))
            assets=root/'assets';assets.mkdir()
            expected={'name':'payload','digest':'sha256:'+hashlib.sha256(archive.read_bytes()).hexdigest()}
            receipt=p.stage_binary(archive,root/'extract',assets,expected)
            self.assertEqual((assets/'payload').read_bytes(),b'actual-binary')
            self.assertEqual(receipt['sha256'],hashlib.sha256(b'actual-binary').hexdigest())
            self.assertFalse(archive.exists())
            self.assertFalse((root/'extract').exists())

    def test_sbom_metadata_is_deterministic_without_changing_dependencies(self):
        first={'bomFormat':'CycloneDX','serialNumber':'urn:uuid:random-one',
               'metadata':{'timestamp':'2026-10-20T01:00:00Z','component':{'version':p.VERSION}},
               'components':[{'name':'example','version':'1.0.0'}],'dependencies':[{'ref':'example@1.0.0'}]}
        second={**first,'serialNumber':'urn:uuid:random-two','metadata':{**first['metadata'],'timestamp':'2026-10-21T01:00:00Z'}}
        normalized=p.normalize_sbom(first,'core.json','2026-10-20T17:20:07Z')
        self.assertEqual(normalized,p.normalize_sbom(second,'core.json','2026-10-20T17:20:07Z'))
        self.assertEqual(normalized['components'],first['components'])
        self.assertEqual(normalized['dependencies'],first['dependencies'])
        self.assertEqual(first['serialNumber'],'urn:uuid:random-one')
        changed={**second,'components':[{'name':'example','version':'1.0.1'}]}
        self.assertNotEqual(normalized['serialNumber'],p.normalize_sbom(changed,'core.json','2026-10-20T17:20:07Z')['serialNumber'])
        self.assertNotEqual(normalized['serialNumber'],p.normalize_sbom(first,'other.json','2026-10-20T17:20:07Z')['serialNumber'])

    def test_runtime_environment_drops_write_credentials_and_user_npm_config(self):
        env=p.runtime_environment(pathlib.Path('/tmp/owned'),{'PATH':'/bin','HOME':'/private/home','GITHUB_TOKEN':'write','NODE_AUTH_TOKEN':'write','NPM_CONFIG_USERCONFIG':'/private/token','OPENAI_API_KEY':'secret','KUBECONFIG':'/secret'})
        self.assertEqual(env['HOME'],'/tmp/owned/home')
        for key in ['GITHUB_TOKEN','NODE_AUTH_TOKEN','OPENAI_API_KEY','KUBECONFIG']:self.assertNotIn(key,env)
        self.assertEqual(env['NPM_CONFIG_USERCONFIG'],'/tmp/owned/npmrc')

if __name__=='__main__':unittest.main()
