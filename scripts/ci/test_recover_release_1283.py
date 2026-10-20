import base64
import copy
import hashlib
import importlib.util
import io
import pathlib
import stat
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location('recovery', pathlib.Path(__file__).with_name('recover-release-1283.py'))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)

class RecoveryTests(unittest.TestCase):
    def run_fixture(self):
        return dict(id=39465167710, run_attempt=1, repository={'full_name': r.REPOSITORY}, event='push', head_branch='main', head_sha=r.SOURCE, path='.github/workflows/cicd.yml', status='completed', conclusion='failure')

    def test_original_failed_run_can_supply_successful_build_jobs(self):
        r.validate_run(self.run_fixture(), 39465167710, 'push', 'main', '.github/workflows/cicd.yml', ['Build'], [{'name':'Build','status':'completed','conclusion':'success','run_id':39465167710}])

    def test_run_identity_and_jobs_fail_closed(self):
        for key, value in [('run_attempt',2),('head_sha','a'*40),('event','workflow_dispatch'),('head_branch','other'),('path','other'),('repository',{'full_name':'attacker/repo'})]:
            run=self.run_fixture(); run[key]=value
            with self.subTest(key=key), self.assertRaises(ValueError):
                r.validate_run(run,39465167710,'push','main','.github/workflows/cicd.yml',['Build'],[{'name':'Build','status':'completed','conclusion':'success','run_id':39465167710}])
        for jobs in [[],[{'name':'Build','status':'completed','conclusion':'failure','run_id':39465167710}], [{'name':'Build','status':'completed','conclusion':'success','run_id':1}]]:
            with self.assertRaises(ValueError): r.validate_run(self.run_fixture(),39465167710,'push','main','.github/workflows/cicd.yml',['Build'],jobs)

    def archive(self, entries):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:
            for name,data in entries: z.writestr(name,data)
        return out.getvalue()

    def test_binary_zip_rejects_inventory_escape_duplicate_and_symlink(self):
        expected={'veryfront-linux-arm64': hashlib.sha256(b'binary').hexdigest()}
        r.validate_binary_zip(self.archive([('veryfront-linux-arm64',b'binary')]),expected)
        for entries in [[('../veryfront-linux-arm64',b'binary')],[('veryfront-linux-arm64',b'wrong')],[('veryfront-linux-arm64',b'binary'),('extra',b'x')],[],[('veryfront-linux-arm64',b'binary')]*2]:
            with self.assertRaises(ValueError): r.validate_binary_zip(self.archive(entries),expected)
        info=zipfile.ZipInfo('veryfront-linux-arm64'); info.create_system=3; info.external_attr=(stat.S_IFLNK|0o777)<<16
        with self.assertRaises(ValueError): r.validate_binary_zip(self.archive([(info,b'binary')]),expected)

    def test_artifact_metadata_and_archive_are_bound(self):
        data=b'archive'; digest=hashlib.sha256(data).hexdigest()
        meta={'id':9,'name':'binary','expired':False,'workflow_run':{'id':39465167710,'head_sha':r.SOURCE},'digest':'sha256:'+digest,'size_in_bytes':len(data)}
        r.validate_artifact(meta,data,9,'binary',39465167710,digest)
        for key,value in [('id',10),('expired',True),('digest','sha256:'+'0'*64),('size_in_bytes',99)]:
            bad=copy.deepcopy(meta); bad[key]=value
            with self.assertRaises(ValueError): r.validate_artifact(bad,data,9,'binary',39465167710,digest)

    def test_registry_requires_root_and_exact_bytes(self):
        data=b'tarball'; sha256=hashlib.sha256(data).hexdigest(); integrity='sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()
        expected={'name':'veryfront','version':r.VERSION,'gitHead':r.SOURCE,'sha256':sha256,'integrity':integrity}
        meta={**expected,'dist':{'integrity':integrity}}
        r.validate_registry(meta,data,expected)
        for key,value in [('name','other'),('gitHead','0'*40),('version','0.1.1282')]:
            bad=copy.deepcopy(meta); bad[key]=value
            with self.assertRaises(ValueError): r.validate_registry(bad,data,expected)
        with self.assertRaises(ValueError): r.validate_registry(meta,b'other',expected)

    def test_registry_inventory_requires_root_and_all_canonical_packages(self):
        expected = ['veryfront', '@veryfront/ext-example']
        r.validate_registry_inventory(expected, expected)
        for actual in [expected[1:], expected + ['unexpected'], expected + ['veryfront']]:
            with self.assertRaises(ValueError): r.validate_registry_inventory(actual, expected)
        with self.assertRaises(ValueError): r.validate_registry_inventory(expected[1:], expected[1:])

    def test_retained_actual_decoded_statement_identity_only(self):
        # Retained ext-content-mdx statement, decoded only; no signature claim.
        statement = {'_type': 'https://in-toto.io/Statement/v1', 'subject': [{'name': 'pkg:npm/%40veryfront/ext-content-mdx@0.1.1283', 'digest': {'sha512': '9ba2616c7dcd29da5194b11e2427e0d416c0d2df121028e4a2331ffd35ad06b20a19858c520f6931810ba6e4ce68301db91b26f0732053c0df4371c50580e19b'}}], 'predicateType': 'https://slsa.dev/provenance/v1', 'predicate': {'buildDefinition': {'buildType': 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1', 'externalParameters': {'workflow': {'ref': 'refs/heads/main', 'repository': 'https://github.com/veryfront/veryfront-code', 'path': '.github/workflows/cicd.yml'}}, 'internalParameters': {'github': {'event_name': 'push', 'repository_id': '1101259327', 'repository_owner_id': '86209388'}}, 'resolvedDependencies': [{'uri': 'git+https://github.com/veryfront/veryfront-code@refs/heads/main', 'digest': {'gitCommit': '8b9eb53979953e4a934014232982cca02eff63b0'}}]}, 'runDetails': {'builder': {'id': 'https://github.com/actions/runner/github-hosted'}, 'metadata': {'invocationId': 'https://github.com/veryfront/veryfront-code/actions/runs/39465167710/attempts/1'}}}}
        subject = statement['subject'][0]
        r.validate_provenance(statement, subject['name'], subject['digest']['sha512'],
                              39465167710, 1, '.github/workflows/cicd.yml')
        statement['predicate']['buildDefinition']['resolvedDependencies'][0]['digest']['gitCommit'] = '0' * 40
        with self.assertRaises(ValueError):
            r.validate_provenance(statement, subject['name'], subject['digest']['sha512'],
                                  39465167710, 1, '.github/workflows/cicd.yml')

    def test_provenance_binds_subject_and_exact_builder_invocation(self):
        digest='a'*128
        statement={'_type':'https://in-toto.io/Statement/v1','subject':[{'name':'pkg:npm/veryfront@'+r.VERSION,'digest':{'sha512':digest}}], 'predicateType':'https://slsa.dev/provenance/v1','predicate':{'buildDefinition':{'buildType':'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1','externalParameters':{'workflow':{'repository':'https://github.com/'+r.REPOSITORY,'ref':'refs/heads/main','path':'.github/workflows/cicd.yml'}},'resolvedDependencies':[{'uri':'git+https://github.com/'+r.REPOSITORY+'@refs/heads/main','digest':{'gitCommit':r.SOURCE}}]},'runDetails':{'builder':{'id':'https://github.com/actions/runner/github-hosted'},'metadata':{'invocationId':'https://github.com/'+r.REPOSITORY+'/actions/runs/39465167710/attempts/1'}}}}
        r.validate_provenance(statement,'pkg:npm/veryfront@'+r.VERSION,digest,39465167710,1,'.github/workflows/cicd.yml')
        for mutate in [lambda x:x['subject'][0]['digest'].update(sha512='b'*128), lambda x:x['predicate']['runDetails']['metadata'].update(invocationId='https://github.com/'+r.REPOSITORY+'/actions/runs/39465167710/attempts/2'),lambda x:x['predicate']['buildDefinition']['externalParameters']['workflow'].update(repository='https://github.com/attacker/repo')]:
            bad=copy.deepcopy(statement); mutate(bad)
            with self.assertRaises(ValueError): r.validate_provenance(bad,'pkg:npm/veryfront@'+r.VERSION,digest,39465167710,1,'.github/workflows/cicd.yml')

if __name__=='__main__': unittest.main()
