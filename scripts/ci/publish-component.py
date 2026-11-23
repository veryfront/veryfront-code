"""Read-only Code release witness; no npm/public release write authority.

Publisher CI identity and the npm package's historical source revision are
separate facts. Native asset checksums identify compiled materials; this receipt
is not a compiled-build attestation or a staging qualification result.

While npm publication of the core package is suspended, the package is read
from the public release instead: its provenance record and tarball assets.
"""
import base64
import hashlib
from http.client import HTTPException
import io
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import tarfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

CORE=r'(?:0|[1-9][0-9]*)'
PRE=r'(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
VERSION=rf'{CORE}\.{CORE}\.{CORE}(?:-{PRE}(?:\.{PRE})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?'
SHA=r'[a-f0-9]{40}'
INTEGRITY=r'sha512-[A-Za-z0-9+/]{86}=='
SOURCE_URL='git+https://github.com/veryfront/veryfront-code.git'
# Release asset bytes are served only from this host, after one redirect.
ASSET_HOST='release-assets.githubusercontent.com'
PROVENANCE_LIMIT=64*1024
TARBALL_LIMIT=256*1024*1024
# Seconds to wait before each repeat of a transiently failed witness.
TRANSIENT_DELAYS=(5,10,20,40)


class Refused(ValueError):
    # Names the check only. Checked values and response bodies stay out of logs.
    def __init__(self,check):
        super().__init__('Code component publication refused: '+check);self.check=check


class TransientRead(Exception):
    # A read that failed without an answer about the release facts.
    def __init__(self,check):
        super().__init__(check);self.check=check


def require(value,check):
    if not value:raise Refused(check)


def refusal_reason(error):
    if isinstance(error,Refused):return 'failed check: '+error.check
    if isinstance(error,TransientRead):return error.check
    if isinstance(error,HTTPError):
        route=urlsplit(error.url or '')
        return 'HTTP '+str(error.code)+' from '+route.scheme+'://'+(route.hostname or '')+route.path
    return type(error).__name__


def unique(pairs):
    result={}
    for key,value in pairs:
        require(key not in result,'JSON object has no duplicate key');result[key]=value
    return result


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None


def public_json(url):
    # Call sites construct only the fixed public registry/release routes below.
    with build_opener(NoRedirect).open(Request(url,headers={'Accept':'application/json','User-Agent':'platform-component-publication'}),timeout=30) as response:
        require(response.status==200,'public record status')
        raw=response.read(2*1024*1024+1)
        require(0<len(raw)<=2*1024*1024,'public record size')
    return json.loads(raw,object_pairs_hook=unique)


class AssetRedirect(HTTPRedirectHandler):
    # The fixed asset route answers with exactly one redirect to the asset host.
    max_redirections=1
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        target=urlsplit(newurl)
        require(urlsplit(req.full_url).hostname=='api.github.com' and target.scheme=='https'
                and target.hostname==ASSET_HOST and target.port is None and not target.username and not target.password,
                'release asset redirect target')
        return Request(newurl,headers={'User-Agent':'platform-component-publication'})


def public_asset(asset_id,size):
    # Call sites pass only asset ids from the fixed public release listing.
    require(type(asset_id) is int and asset_id>0 and type(size) is int and 0<size<=TARBALL_LIMIT,'release asset request bounds')
    url='https://api.github.com/repos/veryfront/veryfront/releases/assets/'+str(asset_id)
    request=Request(url,headers={'Accept':'application/octet-stream','User-Agent':'platform-component-publication'})
    with build_opener(AssetRedirect).open(request,timeout=120) as response:
        # GitHub either streams the asset from the fixed route or redirects once.
        final=response.geturl()
        require(response.status==200 and (final==url or urlsplit(final).hostname==ASSET_HOST),'release asset response route')
        raw=response.read(size+1)
    require(len(raw)==size,'release asset download size')
    return raw


def source_json(path):
    require(path.startswith('repos/veryfront/veryfront-code/'),'source read route')
    projection = '{sha}' if '/commits/' in path else '{status,base_commit:{sha:.base_commit.sha}}'
    check='source read '+('commit' if '/commits/' in path else 'comparison')
    try:
        result=subprocess.run(['gh','api','--hostname','github.com',path,'--jq',projection],capture_output=True,timeout=60,check=False)
    except subprocess.TimeoutExpired:
        raise TransientRead(check+' timed out') from None
    if result.returncode!=0:
        # gh reports an API answer as "(HTTP <status>)". A 5xx status, or no
        # answer at all, is a failed read. Any other status is a refusal.
        status=re.search(rb'\(HTTP ([0-9]{3})\)',result.stderr or b'')
        if status is None:raise TransientRead(check+' got no response')
        if status.group(1)>=b'500':raise TransientRead(check+' got HTTP '+status.group(1).decode())
    require(result.returncode==0 and 0<len(result.stdout)<=2*1024*1024,check)
    return json.loads(result.stdout,object_pairs_hook=unique)


def public_release(version,read_public):
    release=read_public('https://api.github.com/repos/veryfront/veryfront/releases/tags/v'+quote(version,safe=''))
    require(type(release.get('id')) is int and release['id']>0 and release.get('draft') is False
            and release.get('tag_name')=='v'+version,'release record identity')
    assets=release.get('assets');require(type(assets) is list and len(assets)<=1000,'release asset list')
    return release


def release_asset(assets,name):
    found=[asset for asset in assets if asset.get('name')==name]
    require(len(found)==1,'release asset '+name+' is listed once')
    asset=found[0]
    require(type(asset.get('id')) is int and asset['id']>0 and type(asset.get('size')) is int and asset['size']>0
            and type(asset.get('digest')) is str and re.fullmatch(r'sha256:[a-f0-9]{64}',asset['digest']),
            'release asset '+name+' id, size and digest')
    return {'asset_id':asset['id'],'name':name,'digest':asset['digest'],'size':asset['size']}


def asset_bytes(asset,limit,read_asset):
    require(asset['size']<=limit,'release asset '+asset['name']+' size limit')
    raw=read_asset(asset['asset_id'],asset['size'])
    require(type(raw) is bytes and len(raw)==asset['size']
            and 'sha256:'+hashlib.sha256(raw).hexdigest()==asset['digest'],'release asset '+asset['name']+' digest')
    return raw


def packaged_manifest(tarball):
    found=[]
    with tarfile.open(fileobj=io.BytesIO(tarball),mode='r:gz') as archive:
        for count,member in enumerate(archive,1):
            require(count<=100000,'package tarball member count')
            if member.name=='package/package.json':
                require(member.isfile() and 0<member.size<=1024*1024,'packaged manifest size')
                found.append(archive.extractfile(member).read(member.size+1))
    require(len(found)==1,'packaged manifest is present once')
    return json.loads(found[0],object_pairs_hook=unique)


def registry_package(version,read_public):
    package=read_public('https://registry.npmjs.org/veryfront/'+quote(version,safe=''))
    require(package.get('name')=='veryfront' and package.get('version')==version
            and package.get('repository',{}).get('url')==SOURCE_URL,'npm package identity')
    return package.get('gitHead'),package.get('dist',{}).get('integrity')


def release_package(version,assets,read_asset):
    # Same facts as the registry record, from the provenance the publishing run
    # attached, bound to the tarball bytes and its packaged manifest.
    provenance_asset=release_asset(assets,'veryfront-'+version+'.npm-provenance.json')
    tarball_asset=release_asset(assets,'veryfront-'+version+'.tgz')
    record=json.loads(asset_bytes(provenance_asset,PROVENANCE_LIMIT,read_asset),object_pairs_hook=unique)
    require(type(record) is dict and set(record)=={'schema_version','package','git_head','repository'}
            and type(record['schema_version']) is int and record['schema_version']==1
            and record['repository']=='https://github.com/veryfront/veryfront-code','provenance record shape')
    package=record['package']
    require(type(package) is dict and set(package)=={'name','version','integrity'}
            and package['name']=='veryfront' and package['version']==version,'provenance package identity')
    origin,integrity=record['git_head'],package['integrity']
    require(type(origin) is str and re.fullmatch(SHA,origin) and type(integrity) is str and re.fullmatch(INTEGRITY,integrity),
            'provenance gitHead and integrity format')
    tarball=asset_bytes(tarball_asset,TARBALL_LIMIT,read_asset)
    require('sha512-'+base64.b64encode(hashlib.sha512(tarball).digest()).decode()==integrity,'package tarball integrity')
    manifest=packaged_manifest(tarball)
    require(type(manifest) is dict and manifest.get('name')=='veryfront' and manifest.get('version')==version
            and type(manifest.get('repository')) is dict and manifest['repository'].get('url')==SOURCE_URL
            and manifest.get('gitHead')==origin,'packaged manifest identity and gitHead')
    return origin,integrity,tarball_asset


def witness(version,env,read_public=public_json,read_source=source_json,read_asset=public_asset):
    require(type(version) is str and len(version)<=128 and re.fullmatch(VERSION,version),'version format')
    require(env.get('GITHUB_ACTIONS')=='true' and env.get('GITHUB_REPOSITORY')=='veryfront/veryfront-code'
            and env.get('GITHUB_REF')=='refs/heads/main' and env.get('GITHUB_EVENT_NAME') in ('push','workflow_dispatch'),
            'CI source context')
    sha=env.get('GITHUB_SHA','');require(re.fullmatch(SHA,sha),'CI commit format')
    for key in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'):require(re.fullmatch(r'[1-9][0-9]{0,19}',env.get(key,'')),key+' format')
    # The publishing run's own mode selects the package source; a registry miss
    # never selects the release on its own.
    suspended=env.get('NPM_CORE_PUBLISH_SUSPENDED');require(suspended in ('true','false'),'core package publication mode')
    if suspended=='true':
        release=public_release(version,read_public)
        origin,integrity,package_asset=release_package(version,release['assets'],read_asset)
    else:
        origin,integrity=registry_package(version,read_public)
    require(type(origin) is str and re.fullmatch(SHA,origin)
            and type(integrity) is str and re.fullmatch(INTEGRITY,integrity),'package gitHead and integrity format')
    material=base64.b64decode(integrity[7:],validate=True)
    require(len(material)==64 and base64.b64encode(material).decode()==integrity[7:],'package integrity encoding')
    commit=read_source('repos/veryfront/veryfront-code/commits/'+origin)
    require(commit.get('sha')==origin,'package gitHead is a source commit')
    if origin!=sha:
        comparison=read_source('repos/veryfront/veryfront-code/compare/'+origin+'...'+sha)
        require(comparison.get('status')=='ahead' and comparison.get('base_commit',{}).get('sha')==origin,
                'package gitHead is an ancestor of the CI commit')
    if suspended=='false':release=public_release(version,read_public)
    assets=release['assets']
    binaries={}
    for platform,architecture in [('linux/amd64','x64'),('linux/arm64','arm64')]:
        roles={}
        for role,prefix in [('renderer','veryfront'),('proxy','veryfront-proxy')]:
            roles[role]=release_asset(assets,prefix+'-linux-'+architecture)
        binaries[platform]=roles
    code_release={'repository':'veryfront/veryfront','release_id':release['id'],'version':version,
                  'package_source_revision':origin,
                  'package':{'name':'veryfront','version':version,'integrity':integrity},'binaries':binaries}
    if suspended=='true':code_release['package_asset']=package_asset
    return {'schema_version':1,'component':'code',
            'source':{'repository':'veryfront/veryfront-code','sha':sha,
                      'ci_run_id':int(env['GITHUB_RUN_ID']),'ci_run_attempt':int(env['GITHUB_RUN_ATTEMPT'])},
            'configuration':{'source_revision':sha},
            'release':code_release}


def witness_when_ready(version,env,read_public=public_json,read_source=source_json,
                       clock=time.monotonic,sleep=time.sleep,read_asset=public_asset):
    # An unchanged-version main run can overtake the run publishing that version.
    # Wait only for absent public material, never for invalid release facts.
    # The observed publication gap was ten minutes; bound this wait to fifteen.
    # A server error or a transport failure says nothing about the release facts,
    # so the read-only witness is repeated a bounded number of times inside the
    # same deadline. Every other status and every failed check refuses at once.
    deadline=clock()+15*60
    transient=0
    while True:
        try:
            return witness(version,env,read_public,read_source,read_asset)
        except HTTPError as error:
            if error.code==404:
                remaining=deadline-clock()
                if remaining<=0:raise TimeoutError('Code release material was not published within fifteen minutes') from None
                print('Waiting for public Code release material',file=sys.stderr)
                sleep(min(30,remaining))
                if clock()>=deadline:raise TimeoutError('Code release material was not published within fifteen minutes') from None
                continue
            if error.code<500:raise
            failure=error
        except (URLError,TimeoutError,ConnectionError,ssl.SSLError,HTTPException,TransientRead) as error:
            failure=error
        transient+=1
        delay=min(TRANSIENT_DELAYS[transient-1] if transient<=len(TRANSIENT_DELAYS) else 0,deadline-clock())
        if delay<=0:raise failure
        print('Retrying after a transient read failure ('+refusal_reason(failure)+')',file=sys.stderr)
        sleep(delay)
        # A further attempt can take minutes of read timeouts. Do not start one
        # at or past the deadline.
        if clock()>=deadline:raise failure


if __name__=='__main__':
    try:
        require(len(sys.argv)==2,'argument count')
        value=witness_when_ready(sys.argv[1],os.environ)
        with open('platform-component.json','x') as output:output.write(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n')
    except Exception as error:
        print('Code release witness refused ('+refusal_reason(error)+'); no component receipt issued',file=sys.stderr)
        raise SystemExit(1)
