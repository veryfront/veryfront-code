import base64
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('component_publisher',Path(__file__).with_name('publish-component.py'))
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
VERSION='0.1.1278'
SOURCE='b'*40
ENV={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'veryfront/veryfront-code','GITHUB_REF':'refs/heads/main',
     'GITHUB_EVENT_NAME':'push','GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'101','GITHUB_RUN_ATTEMPT':'1'}

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
