import base64
import contextlib
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request

spec=importlib.util.spec_from_file_location('component_publisher',Path(__file__).with_name('publish-component.py'))
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
VERSION='0.1.1278'
SOURCE='b'*40
ENV={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'veryfront/veryfront-code','GITHUB_REF':'refs/heads/main',
     'GITHUB_EVENT_NAME':'push','GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'101','GITHUB_RUN_ATTEMPT':'1',
     'NPM_CORE_PUBLISH_SUSPENDED':'false'}
SUSPENDED={**ENV,'NPM_CORE_PUBLISH_SUSPENDED':'true'}

class Facts:
    def __init__(self):
        self.calls=[]
        self.package={'name':'veryfront','version':VERSION,'gitHead':SOURCE,
          'repository':{'url':'git+https://github.com/veryfront/veryfront-code.git'},
          'dist':{'integrity':'sha512-'+base64.b64encode(b'p'*64).decode()}}
        self.release={'id':501,'tag_name':'v'+VERSION,'draft':False,'assets':[]}
        for index,name in enumerate(['veryfront-linux-x64','veryfront-proxy-linux-x64','veryfront-linux-arm64','veryfront-proxy-linux-arm64'],1):
            self.release['assets'].append({'id':600+index,'name':name,'digest':'sha256:'+str(index)*64,'size':1000+index})
        self.ancestry={'status':'ahead','base_commit':{'sha':SOURCE}}
    def public(self,path):
        self.calls.append(path)
        if path=='https://registry.npmjs.org/veryfront/'+VERSION:return deepcopy(self.package)
        assert path=='https://api.github.com/repos/veryfront/veryfront/releases/tags/v'+VERSION
        return deepcopy(self.release)
    def source(self,path):
        self.calls.append(path)
        if '/commits/' in path:return {'sha':SOURCE}
        assert path=='repos/veryfront/veryfront-code/compare/'+SOURCE+'...'+ENV['GITHUB_SHA']
        return deepcopy(self.ancestry)
    def witness(self,env=None):return publisher.witness(VERSION,env or ENV,self.public,self.source)

class CodeWitnessTests(unittest.TestCase):
    def test_existing_release_facts_are_separate_from_the_witnessing_program(self):
        facts=Facts();result=facts.witness()
        self.assertEqual(result['source']['sha'],ENV['GITHUB_SHA'])
        self.assertEqual(result['release']['package_source_revision'],SOURCE)
        self.assertEqual(result['release']['package']['version'],VERSION)
        self.assertEqual(set(result['release']['binaries']),{'linux/amd64','linux/arm64'})
        self.assertNotIn('qualified',result)
        self.assertFalse(any('publish' in call for call in facts.calls))
    def test_unrelated_or_unavailable_package_source_is_refused(self):
        for value in [{'status':'diverged','base_commit':{'sha':SOURCE}},{'status':'ahead','base_commit':{'sha':'c'*40}}]:
            facts=Facts();facts.ancestry=value
            with self.subTest(value=value),self.assertRaises(ValueError):facts.witness()
    def test_wrong_source_context_cannot_issue_a_receipt(self):
        for key,value in [('GITHUB_REPOSITORY','foreign/code'),('GITHUB_REF','refs/heads/feature'),
                          ('GITHUB_EVENT_NAME','pull_request'),('GITHUB_RUN_ATTEMPT','0')]:
            facts=Facts()
            with self.subTest(key=key),self.assertRaises(ValueError):facts.witness({**ENV,key:value})
            self.assertEqual(facts.calls,[])
    def test_package_version_integrity_or_source_substitution_is_refused(self):
        for key,value in [('version','0.1.1279'),('gitHead','main'),('dist',{'integrity':'unchecked'})]:
            facts=Facts();facts.package[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):facts.witness()
    def test_missing_duplicate_or_unhashed_native_binary_is_refused(self):
        for mode in ['missing','duplicate','digest']:
            facts=Facts()
            if mode=='missing':facts.release['assets'].pop()
            elif mode=='duplicate':facts.release['assets'].append(deepcopy(facts.release['assets'][0]))
            else:facts.release['assets'][0]['digest']=None
            with self.subTest(mode=mode),self.assertRaises(ValueError):facts.witness()
    def test_release_identity_cannot_be_borrowed_from_a_draft_or_other_version(self):
        for key,value in [('id',True),('draft',True),('tag_name','v0.1.1279')]:
            facts=Facts();facts.release[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):facts.witness()

def tarball(manifest,extra=()):
    output=io.BytesIO()
    with tarfile.open(fileobj=output,mode='w:gz') as archive:
        for name,content in [('package/package.json',json.dumps(manifest).encode()),*extra]:
            member=tarfile.TarInfo(name);member.size=len(content)
            archive.addfile(member,io.BytesIO(content))
    return output.getvalue()

class SuspendedFacts(Facts):
    """The core package exists only as release assets; the registry has no record."""
    def __init__(self):
        super().__init__()
        self.manifest={'name':'veryfront','version':VERSION,'gitHead':SOURCE,
                       'repository':{'type':'git','url':'git+https://github.com/veryfront/veryfront-code.git'}}
        self.provenance={'schema_version':1,'package':{'name':'veryfront','version':VERSION,'integrity':None},
                         'git_head':SOURCE,'repository':'https://github.com/veryfront/veryfront-code'}
        self.extra=()
        self.downloads=[]
    def build(self):
        self.tgz=tarball(self.manifest,self.extra)
        if self.provenance['package']['integrity'] is None:
            self.provenance['package']['integrity']='sha512-'+base64.b64encode(hashlib.sha512(self.tgz).digest()).decode()
        self.record=json.dumps(self.provenance).encode()
        self.blobs={701:self.tgz,702:self.record}
        self.release['assets']+=[
            {'id':701,'name':'veryfront-'+VERSION+'.tgz','size':len(self.tgz),'digest':'sha256:'+hashlib.sha256(self.tgz).hexdigest()},
            {'id':702,'name':'veryfront-'+VERSION+'.npm-provenance.json','size':len(self.record),
             'digest':'sha256:'+hashlib.sha256(self.record).hexdigest()}]
        return self
    def public(self,path):
        if path.startswith('https://registry.npmjs.org/'):
            self.calls.append(path)
            raise HTTPError(path,404,'Not Found',{},None)
        return super().public(path)
    def asset(self,asset_id,size):
        self.downloads.append(asset_id)
        return self.blobs[asset_id]
    def witness(self,env=None):
        return publisher.witness(VERSION,env or SUSPENDED,self.public,self.source,self.asset)

class SuspendedCoreWitnessTests(unittest.TestCase):
    def test_release_provenance_and_tarball_supply_the_package_facts(self):
        facts=SuspendedFacts().build();result=facts.witness()
        self.assertEqual(result['release']['package_source_revision'],SOURCE)
        self.assertEqual(result['release']['package'],
                         {'name':'veryfront','version':VERSION,'integrity':facts.provenance['package']['integrity']})
        self.assertEqual(result['release']['package_asset'],
                         {'asset_id':701,'name':'veryfront-'+VERSION+'.tgz','size':len(facts.tgz),
                          'digest':'sha256:'+hashlib.sha256(facts.tgz).hexdigest()})
        self.assertEqual(set(result['release']['binaries']),{'linux/amd64','linux/arm64'})
        self.assertEqual(sorted(facts.downloads),[701,702])
        self.assertFalse(any('registry.npmjs.org' in call for call in facts.calls))
        self.assertIn('repos/veryfront/veryfront-code/compare/'+SOURCE+'...'+ENV['GITHUB_SHA'],facts.calls)

    def test_registry_receipt_is_unchanged_when_not_suspended(self):
        result=Facts().witness()
        self.assertEqual(set(result['release']),{'repository','release_id','version','package_source_revision','package','binaries'})

    def test_missing_or_unknown_mode_is_refused_before_any_read(self):
        for value in [None,'','yes','True']:
            facts=SuspendedFacts().build();env={**SUSPENDED}
            if value is None:del env['NPM_CORE_PUBLISH_SUSPENDED']
            else:env['NPM_CORE_PUBLISH_SUSPENDED']=value
            with self.subTest(value=value),self.assertRaises(ValueError):facts.witness(env)
            self.assertEqual(facts.calls,[])

    def test_tarball_that_differs_from_provenance_or_release_digest_is_refused(self):
        def wrong_integrity(f):f.provenance['package']['integrity']='sha512-'+base64.b64encode(b'q'*64).decode()
        def wrong_digest(f):f.release['assets'][-2]['digest']='sha256:'+'0'*64
        def swapped_bytes(f):f.blobs[701]=f.tgz[:-1]+bytes([f.tgz[-1]^1])
        def short_read(f):f.blobs[701]=f.tgz[:-1]
        for mutate in (wrong_integrity,wrong_digest,swapped_bytes,short_read):
            facts=SuspendedFacts()
            if mutate is wrong_integrity:mutate(facts)
            facts.build()
            if mutate is not wrong_integrity:mutate(facts)
            with self.subTest(case=mutate.__name__),self.assertRaises(ValueError):facts.witness()

    def test_provenance_that_names_another_package_or_source_is_refused(self):
        for key,value in [('git_head','main'),('repository','https://github.com/foreign/veryfront-code'),
                          ('schema_version',2),('extra',True),('package',{'name':'veryfront','version':'0.1.1279','integrity':None})]:
            facts=SuspendedFacts();facts.provenance[key]=value;facts.build()
            with self.subTest(key=key),self.assertRaises(ValueError):facts.witness()

    def test_packaged_manifest_must_match_provenance(self):
        for key,value in [('gitHead','c'*40),('version','0.1.1279'),('name','other'),
                          ('repository',{'url':'git+https://github.com/foreign/veryfront-code.git'})]:
            facts=SuspendedFacts();facts.manifest[key]=value;facts.build()
            with self.subTest(key=key),self.assertRaises(ValueError):facts.witness()
        facts=SuspendedFacts();facts.extra=[('package/package.json',json.dumps(facts.manifest).encode())];facts.build()
        with self.assertRaises(ValueError):facts.witness()

    def test_missing_or_duplicate_package_assets_are_refused(self):
        for mode in ['tarball','provenance','duplicate']:
            facts=SuspendedFacts().build()
            if mode=='tarball':facts.release['assets'].pop(-2)
            elif mode=='provenance':facts.release['assets'].pop()
            else:facts.release['assets'].append(deepcopy(facts.release['assets'][-1]))
            with self.subTest(mode=mode),self.assertRaises(ValueError):facts.witness()
            self.assertEqual(facts.downloads,[])

    def test_ancestry_check_still_binds_the_provenance_source(self):
        facts=SuspendedFacts().build();facts.ancestry={'status':'diverged','base_commit':{'sha':SOURCE}}
        with self.assertRaises(ValueError):facts.witness()

    def test_waits_for_the_release_in_suspended_mode(self):
        facts=SuspendedFacts().build();attempts=[];elapsed=[0]
        def public(url):
            if '/releases/tags/' in url:
                attempts.append(url)
                if len(attempts)<2:raise HTTPError(url,404,'Not Found',{},None)
            return facts.public(url)
        def sleep(seconds):elapsed[0]+=seconds
        result=publisher.witness_when_ready(VERSION,SUSPENDED,public,facts.source,
            clock=lambda:elapsed[0],sleep=sleep,read_asset=facts.asset)
        self.assertEqual(len(attempts),2)
        self.assertEqual(result['release']['package_asset']['asset_id'],701)

class AssetRouteTests(unittest.TestCase):
    def test_asset_downloads_follow_only_one_redirect_to_the_asset_host(self):
        handler=publisher.AssetRedirect()
        self.assertEqual(handler.max_redirections,1)
        origin=Request('https://api.github.com/repos/veryfront/veryfront/releases/assets/701')
        allowed=handler.redirect_request(origin,None,302,'Found',{},'https://release-assets.githubusercontent.com/x?sig=1')
        self.assertEqual(allowed.full_url,'https://release-assets.githubusercontent.com/x?sig=1')
        self.assertIsNone(allowed.get_header('Authorization'))
        for target in ['http://release-assets.githubusercontent.com/x','https://example.com/x',
                       'https://release-assets.githubusercontent.com:8443/x','https://user@release-assets.githubusercontent.com/x']:
            with self.subTest(target=target),self.assertRaises(ValueError):
                handler.redirect_request(origin,None,302,'Found',{},target)
        hop=Request('https://release-assets.githubusercontent.com/x')
        with self.assertRaises(ValueError):
            handler.redirect_request(hop,None,302,'Found',{},'https://release-assets.githubusercontent.com/y')

    def test_asset_reader_accepts_a_direct_stream_or_the_asset_host_only(self):
        route='https://api.github.com/repos/veryfront/veryfront/releases/assets/701'
        class Response:
            def __init__(self,final):self.status=200;self.final=final
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def geturl(self):return self.final
            def read(self,limit):return b'x'*3
        def opener_for(final):
            class Opener:
                def open(self,request,timeout):
                    assert request.full_url==route and request.get_header('Accept')=='application/octet-stream'
                    return Response(final)
            return lambda *_:Opener()
        original=publisher.build_opener
        try:
            for final in [route,'https://release-assets.githubusercontent.com/x?sig=1']:
                publisher.build_opener=opener_for(final)
                with self.subTest(final=final):self.assertEqual(publisher.public_asset(701,3),b'xxx')
            for final in ['https://api.github.com/repos/foreign/x/releases/assets/701','https://example.com/x']:
                publisher.build_opener=opener_for(final)
                with self.subTest(final=final),self.assertRaises(ValueError):publisher.public_asset(701,3)
            publisher.build_opener=opener_for(route)
            with self.assertRaises(ValueError):publisher.public_asset(701,4)
        finally:
            publisher.build_opener=original

    def test_asset_reader_refuses_unbounded_requests(self):
        for asset_id,size in [(0,1),(True,1),(1,0),(1,publisher.TARBALL_LIMIT+1)]:
            with self.subTest(asset_id=asset_id,size=size),self.assertRaises(ValueError):
                publisher.public_asset(asset_id,size)

class ReleaseReadinessTests(unittest.TestCase):
    def test_waits_for_publication_without_weakening_the_witness(self):
        from urllib.error import HTTPError
        facts=Facts(); attempts=[]; elapsed=[0]
        def public(url):
            if '/releases/tags/' in url:
                attempts.append(url)
                if len(attempts)<3:raise HTTPError(url,404,'Not Found',{},None)
            return facts.public(url)
        def sleep(seconds):elapsed[0]+=seconds
        result=publisher.witness_when_ready(VERSION,ENV,public,facts.source,
            clock=lambda:elapsed[0],sleep=sleep)
        self.assertEqual(elapsed[0],60)
        self.assertEqual(len(attempts),3)
        self.assertEqual(result['release']['package_source_revision'],SOURCE)
        self.assertEqual(set(result['release']['binaries']),{'linux/amd64','linux/arm64'})

    def test_missing_publication_is_bounded(self):
        from urllib.error import HTTPError
        elapsed=[0]; attempts=[]
        def public(url):
            attempts.append(url)
            raise HTTPError(url,404,'Not Found',{},None)
        def sleep(seconds):elapsed[0]+=seconds
        with self.assertRaises(TimeoutError):
            publisher.witness_when_ready(VERSION,ENV,public,Facts().source,
                clock=lambda:elapsed[0],sleep=sleep)
        self.assertEqual(elapsed[0],900)
        self.assertEqual(len(attempts),30)

    def test_other_http_failures_and_invalid_materials_fail_immediately(self):
        from urllib.error import HTTPError
        def no_sleep(_):self.fail('Invalid release facts must not be retried')
        for status in (401,403,429):
            def public(url):raise HTTPError(url,status,'Refused',{},None)
            with self.subTest(status=status),self.assertRaises(HTTPError):
                publisher.witness_when_ready(VERSION,ENV,public,Facts().source,sleep=no_sleep)
        facts=Facts();facts.release['assets'][0]['digest']=None
        with self.assertRaises(ValueError):
            publisher.witness_when_ready(VERSION,ENV,facts.public,facts.source,sleep=no_sleep)

    def test_transient_server_and_transport_failures_are_retried(self):
        failures={'server':lambda url:HTTPError(url,502,'Bad Gateway',{},None),
                  'transport':lambda url:URLError('connection reset'),
                  'timeout':lambda url:TimeoutError('timed out')}
        for name,failure in failures.items():
            facts=Facts();attempts=[];elapsed=[0];log=io.StringIO()
            def public(url):
                attempts.append(url)
                if len(attempts)==1:raise failure(url)
                return facts.public(url)
            def sleep(seconds):elapsed[0]+=seconds
            with self.subTest(failure=name),contextlib.redirect_stderr(log):
                result=publisher.witness_when_ready(VERSION,ENV,public,facts.source,
                    clock=lambda:elapsed[0],sleep=sleep)
                self.assertEqual(result['release']['package_source_revision'],SOURCE)
                self.assertEqual(elapsed[0],5)
                self.assertIn('Retrying after a transient read failure',log.getvalue())

    def test_persistent_server_failure_is_refused_after_bounded_retries(self):
        elapsed=[0];attempts=[]
        def public(url):
            attempts.append(url)
            raise HTTPError(url,503,'Unavailable',{},None)
        def sleep(seconds):elapsed[0]+=seconds
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(HTTPError):
            publisher.witness_when_ready(VERSION,ENV,public,Facts().source,
                clock=lambda:elapsed[0],sleep=sleep)
        self.assertEqual(len(attempts),5)
        self.assertEqual(elapsed[0],75)

    def test_transient_retries_stay_inside_the_publication_deadline(self):
        elapsed=[0];attempts=[]
        def public(url):
            attempts.append(url)
            if len(attempts)<=29:raise HTTPError(url,404,'Not Found',{},None)
            raise HTTPError(url,502,'Bad Gateway',{},None)
        def sleep(seconds):elapsed[0]+=seconds
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(HTTPError):
            publisher.witness_when_ready(VERSION,ENV,public,Facts().source,
                clock=lambda:elapsed[0],sleep=sleep)
        self.assertEqual(elapsed[0],900)
        # 29 waits, then retries at 870, 875 and 885 s. The sleep that reaches
        # the deadline is not followed by another attempt.
        self.assertEqual(len(attempts),32)

    def test_transient_source_read_failures_are_retried(self):
        failures={'server':(1,b'gh: Bad Gateway (HTTP 502)\n'),'transport':(1,b'error connecting to api.github.com\n'),
                  'timeout':None}
        for name,failure in failures.items():
            facts=Facts();runs=[];elapsed=[0];log=io.StringIO()
            def run(command,**options):
                runs.append(command)
                path=command[4]
                if len(runs)==1:
                    if failure is None:raise subprocess.TimeoutExpired(command,60)
                    return subprocess.CompletedProcess(command,failure[0],b'',failure[1])
                return subprocess.CompletedProcess(command,0,json.dumps(facts.source(path)).encode(),b'')
            def sleep(seconds):elapsed[0]+=seconds
            original=publisher.subprocess.run
            publisher.subprocess.run=run
            try:
                with self.subTest(failure=name),contextlib.redirect_stderr(log):
                    result=publisher.witness_when_ready(VERSION,ENV,facts.public,clock=lambda:elapsed[0],sleep=sleep)
                    self.assertEqual(result['release']['package_source_revision'],SOURCE)
                    self.assertEqual(elapsed[0],5)
                    self.assertIn('Retrying after a transient read failure (source read commit',log.getvalue())
            finally:
                publisher.subprocess.run=original

    def test_rejected_source_reads_are_refused_at_once(self):
        def no_sleep(_):self.fail('A rejected source read must not be retried')
        for stderr in (b'gh: Not Found (HTTP 404)\n',b'gh: Forbidden (HTTP 403)\n',b'gh: Unprocessable (HTTP 422)\n'):
            def run(command,**options):return subprocess.CompletedProcess(command,1,b'',stderr)
            original=publisher.subprocess.run
            publisher.subprocess.run=run
            try:
                with self.subTest(stderr=stderr),self.assertRaises(ValueError) as refused:
                    publisher.witness_when_ready(VERSION,ENV,Facts().public,sleep=no_sleep)
                self.assertEqual(publisher.refusal_reason(refused.exception),'failed check: source read commit')
            finally:
                publisher.subprocess.run=original

class RefusalReportTests(unittest.TestCase):
    def reason(self,facts):
        try:facts.witness()
        except Exception as error:return publisher.refusal_reason(error)
        raise AssertionError('The witness must refuse these facts')

    def test_refusal_names_the_failed_check(self):
        def git_head(f):f.package['gitHead']='main'
        def ancestry(f):f.ancestry={'status':'diverged','base_commit':{'sha':SOURCE}}
        def digest(f):f.release['assets'][0]['digest']=None
        def draft(f):f.release['draft']=True
        for mutate,expected in [(git_head,'package gitHead and integrity format'),
                                (ancestry,'package gitHead is an ancestor of the CI commit'),
                                (digest,'release asset veryfront-linux-x64 id, size and digest'),
                                (draft,'release record identity')]:
            facts=Facts();mutate(facts)
            with self.subTest(case=mutate.__name__):self.assertEqual(self.reason(facts),'failed check: '+expected)
        facts=SuspendedFacts().build();facts.blobs[701]=facts.tgz[:-1]+bytes([facts.tgz[-1]^1])
        self.assertEqual(self.reason(facts),'failed check: release asset veryfront-'+VERSION+'.tgz digest')

    def test_http_refusal_reports_status_and_route_without_query_or_body(self):
        error=HTTPError('https://release-assets.githubusercontent.com/x?sig=secret#part',503,'Unavailable',{},
                        io.BytesIO(b'private body'))
        self.assertEqual(publisher.refusal_reason(error),'HTTP 503 from https://release-assets.githubusercontent.com/x')

    def test_other_failures_report_their_type_without_their_message(self):
        self.assertEqual(publisher.refusal_reason(URLError('private detail')),'URLError')
        self.assertEqual(publisher.refusal_reason(KeyError('private detail')),'KeyError')
        self.assertEqual(publisher.refusal_reason(TimeoutError('Code release material was not published within fifteen minutes')),
                         'TimeoutError')

    def test_refused_run_prints_the_failed_check(self):
        script=Path(__file__).with_name('publish-component.py')
        result=subprocess.run([sys.executable,'-I',str(script),'not-a-version'],capture_output=True,text=True,
                              env={},timeout=60,check=False)
        self.assertEqual(result.returncode,1)
        self.assertEqual(result.stderr.strip(),
                         'Code release witness refused (failed check: version format); no component receipt issued')
