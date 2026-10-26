import importlib.util
import pathlib
import json
import unittest

spec = importlib.util.spec_from_file_location('preflight', pathlib.Path(__file__).with_name('recover-release-1283-preflight.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class PreflightTests(unittest.TestCase):
    def test_missing_root_never_ready(self):
        def fetch(url):
            raise ValueError('HTTP 404')
        with self.assertRaisesRegex(ValueError, '404'):
            p.check_root(fetch)

    def test_root_identity_does_not_claim_qualification(self):
        result = p.check_root(lambda url: {'name':'veryfront', 'version':'0.1.1283', 'gitHead':p.verifier.SOURCE,
                                        'dist':{'integrity':'sha512-'+'A'*86+'==', 'tarball':'https://registry.npmjs.org/veryfront/-/veryfront-0.1.1283.tgz'}})
        self.assertEqual(result['status'], 'metadata-available-unqualified')
        self.assertFalse(result['tarballBytesVerified'])
        self.assertFalse(result['signaturesVerified'])

    def test_complete_producer_metadata_still_fails_missing_root(self):
        plan=json.loads((pathlib.Path(__file__).with_name('recover-release-1283.json')).read_text())
        def github(path):
            if '/actions/artifacts/' in path:
                artifact_id=int(path.rsplit('/',1)[1])
                expected=next((x for x in plan['binaryArtifacts'] if x['id']==artifact_id), None)
                if expected:
                    return {**expected,'expired':False,'workflow_run':{'id':p.verifier.MAIN_RUN,'head_sha':p.verifier.SOURCE}}
                return {**plan['npmArtifact'],'digest':'sha256:'+plan['npmArtifact']['sha256'],
                        'expired':False,'workflow_run':{'id':p.verifier.TESTED_RUN,'head_sha':p.verifier.SOURCE}}
            run_id=p.verifier.TESTED_RUN if str(p.verifier.TESTED_RUN) in path else p.verifier.MAIN_RUN
            key='testedNpm' if run_id==p.verifier.TESTED_RUN else 'main'
            if '/jobs?' in path:
                names=plan['mainRequiredJobs'] if key=='main' else ['npm compatibility artifact','quality gate (merge)']
                jobs=[{'name':name,'status':'completed','conclusion':'success','run_id':run_id} for name in names]
                return {'total_count':len(jobs),'jobs':jobs}
            return {'id':run_id,'run_attempt':1,'repository':{'full_name':p.verifier.REPOSITORY},
                    'event':plan[key+'Event'],'head_branch':plan[key+'Ref'],'head_sha':p.verifier.SOURCE,
                    'path':plan['workflowPath'],'status':'completed','conclusion':'success' if key=='testedNpm' else 'failure'}
        def missing(url):raise ValueError('HTTP 404')
        result=p.observe(plan,github,missing)
        self.assertFalse(result['readyForFullQualification'])
        self.assertEqual(len(result['failures']),1)
        self.assertIn('rootPackage',result['failures'][0])
        self.assertEqual(len(result['observations']),3)
        good_root={'name':'veryfront','version':p.verifier.VERSION,'gitHead':p.verifier.SOURCE,
                   'dist':{'integrity':'sha512-'+'A'*86+'==','tarball':'https://registry.npmjs.org/veryfront/-/veryfront-0.1.1283.tgz'}}
        def registry(url):return good_root
        observed_pages=[]
        def paginated(path):
            if '/jobs?' in path:
                full=github(path)['jobs']+[{'name':'extra-'+str(i),'run_id':0} for i in range(105)]
                page=int(path.rsplit('page=',1)[1]);observed_pages.append(page)
                return {'total_count':len(full),'jobs':full[(page-1)*100:page*100]}
            return github(path)
        ready=p.observe(plan,paginated,registry)
        self.assertTrue(ready['readyForFullQualification'])
        self.assertFalse(ready['releaseQualified'])
        self.assertEqual(observed_pages,[1,2,1,2])
        for defect in ['missing-job','changed-job','main-in-progress','npm-id','npm-name']:
            def mutated(path):
                value=github(path)
                if defect in ('missing-job','changed-job') and '/jobs?' in path:
                    if defect=='missing-job':value['jobs']=value['jobs'][1:];value['total_count']-=1
                    else:value['jobs'][0]['conclusion']='failure'
                if defect=='main-in-progress' and str(p.verifier.MAIN_RUN) in path and '/jobs?' not in path:
                    value['status']='in_progress'
                if '/actions/artifacts/'+str(plan['npmArtifact']['id']) in path:
                    if defect=='npm-id':value['id']=1
                    if defect=='npm-name':value['name']='other'
                return value
            with self.subTest(defect=defect):
                failed=p.observe(plan,mutated,registry)
                self.assertFalse(failed['readyForFullQualification'])
                self.assertFalse(failed['releaseQualified'])
                self.assertTrue(failed['failures'])

    def test_jobs_pagination_still_refuses_changed_empty_or_overbound_responses(self):
        for defect in ('changed-total', 'empty-page', 'overbound'):
            calls = []
            def github(path):
                calls.append(path)
                page = int(path.rsplit('page=', 1)[1])
                if defect == 'empty-page':
                    return {'total_count': 2, 'jobs': []}
                total = 1001 if defect == 'overbound' else (2 if page == 1 else 3)
                return {'total_count': total, 'jobs': [{'name': 'unqualified'}]}
            with self.subTest(defect=defect):
                with self.assertRaises(ValueError):
                    p.read_jobs('repos/source/', 1, github)
                self.assertEqual(len(calls), {'changed-total': 2, 'empty-page': 1, 'overbound': 10}[defect])

    def test_wrong_root_source_or_tarball_rejected(self):
        good={'name':'veryfront','version':'0.1.1283','gitHead':p.verifier.SOURCE,
              'dist':{'integrity':'sha512-'+'A'*86+'==','tarball':'https://registry.npmjs.org/veryfront/-/veryfront-0.1.1283.tgz'}}
        for key,value in [('name','other'),('version','0.1.1282'),('gitHead','0'*40)]:
            bad={**good,key:value}
            with self.assertRaises(ValueError):p.check_root(lambda url:bad)
        bad={**good,'dist':{**good['dist'],'tarball':'https://attacker.test/package.tgz'}}
        with self.assertRaises(ValueError):p.check_root(lambda url:bad)

if __name__=='__main__': unittest.main()
