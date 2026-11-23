"""Read-only Code release witness; no npm/public release write authority.

Publisher CI identity and the npm package's historical source revision are
separate facts. Native asset checksums identify compiled materials; this receipt
is not a compiled-build attestation or a staging qualification result.

While npm publication of the core package is suspended, the package is read
from the public release instead: its provenance record and tarball assets.
"""
import base64
import hashlib
from functools import wraps
import io
import json
import os
from pathlib import Path
import re
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


# Labels and kinds are authored constants. Exception messages, URLs, response
# bodies and subprocess output must never enter a publication diagnostic.
PHASES=frozenset({'input','package-identity','source-identity','public-asset','source-read','release-metadata',
                  'release-asset','asset-bytes','package-manifest','registry-package',
                  'release-package','material-wait','receipt-write'})


def phase(label):
    assert label in PHASES
    def decorate(function):
        @wraps(function)
        def run(*args,**kwargs):
            try:return function(*args,**kwargs)
            except Exception as error:
                if not hasattr(error,'witness_phase'):error.witness_phase=label
                raise
        return run
    return decorate


class SourceReadFailure(ValueError):
    def __init__(self,exit_code):
        super().__init__('Source read failed')
        self.exit_code=exit_code


def failure_diagnostic(error):
    label=getattr(error,'witness_phase','unknown')
    result={'phase':label if type(label) is str and label in PHASES else 'unknown'}
    if isinstance(error,HTTPError):
        result['kind']='http'
        if type(error.code) is int and 100<=error.code<=599:result['status']=error.code
    elif isinstance(error,(TimeoutError,subprocess.TimeoutExpired)):
        result['kind']='timeout'
    elif isinstance(error,URLError):
        result['kind']='timeout' if isinstance(error.reason,TimeoutError) else 'network'
    elif isinstance(error,SourceReadFailure):
        result['kind']='subprocess'
        if type(error.exit_code) is int and -255<=error.exit_code<=255:
            result['exit_code']=error.exit_code
    elif isinstance(error,(ValueError,AssertionError)):
        result['kind']='validation'
    elif isinstance(error,OSError):result['kind']='io'
    else:result['kind']='unexpected'
    return result


def require(value):
    if not value:raise ValueError('Code component publication refused')


def unique(pairs):
    result={}
    for key,value in pairs:
        require(key not in result);result[key]=value
    return result


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None


def public_json(url):
    # Call sites construct only the fixed public registry/release routes below.
    with build_opener(NoRedirect).open(Request(url,headers={'Accept':'application/json','User-Agent':'platform-component-publication'}),timeout=30) as response:
        require(response.status==200)
        raw=response.read(2*1024*1024+1)
        require(0<len(raw)<=2*1024*1024)
    return json.loads(raw,object_pairs_hook=unique)


class AssetRedirect(HTTPRedirectHandler):
    # The fixed asset route answers with exactly one redirect to the asset host.
    max_redirections=1
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        target=urlsplit(newurl)
        require(urlsplit(req.full_url).hostname=='api.github.com' and target.scheme=='https'
                and target.hostname==ASSET_HOST and target.port is None and not target.username and not target.password)
        return Request(newurl,headers={'User-Agent':'platform-component-publication'})


@phase('public-asset')
def public_asset(asset_id,size):
    # Call sites pass only asset ids from the fixed public release listing.
    require(type(asset_id) is int and asset_id>0 and type(size) is int and 0<size<=TARBALL_LIMIT)
    url='https://api.github.com/repos/veryfront/veryfront/releases/assets/'+str(asset_id)
    request=Request(url,headers={'Accept':'application/octet-stream','User-Agent':'platform-component-publication'})
    with build_opener(AssetRedirect).open(request,timeout=120) as response:
        # GitHub either streams the asset from the fixed route or redirects once.
        final=response.geturl()
        require(response.status==200 and (final==url or urlsplit(final).hostname==ASSET_HOST))
        raw=response.read(size+1)
    require(len(raw)==size)
    return raw


@phase('source-read')
def source_json(path):
    require(path.startswith('repos/veryfront/veryfront-code/'))
    projection = '{sha}' if '/commits/' in path else '{status,base_commit:{sha:.base_commit.sha}}'
    result=subprocess.run(['gh','api','--hostname','github.com',path,'--jq',projection],capture_output=True,timeout=60,check=False)
    if result.returncode!=0:raise SourceReadFailure(result.returncode)
    require(0<len(result.stdout)<=2*1024*1024)
    return json.loads(result.stdout,object_pairs_hook=unique)


@phase('release-metadata')
def public_release(version,read_public):
    release=read_public('https://api.github.com/repos/veryfront/veryfront/releases/tags/v'+quote(version,safe=''))
    require(type(release.get('id')) is int and release['id']>0 and release.get('draft') is False
            and release.get('tag_name')=='v'+version)
    assets=release.get('assets');require(type(assets) is list and len(assets)<=1000)
    return release


@phase('release-asset')
def release_asset(assets,name):
    found=[asset for asset in assets if asset.get('name')==name]
    require(len(found)==1)
    asset=found[0]
    require(type(asset.get('id')) is int and asset['id']>0 and type(asset.get('size')) is int and asset['size']>0
            and type(asset.get('digest')) is str and re.fullmatch(r'sha256:[a-f0-9]{64}',asset['digest']))
    return {'asset_id':asset['id'],'name':name,'digest':asset['digest'],'size':asset['size']}


@phase('asset-bytes')
def asset_bytes(asset,limit,read_asset):
    require(asset['size']<=limit)
    raw=read_asset(asset['asset_id'],asset['size'])
    require(type(raw) is bytes and len(raw)==asset['size']
            and 'sha256:'+hashlib.sha256(raw).hexdigest()==asset['digest'])
    return raw


@phase('package-manifest')
def packaged_manifest(tarball):
    found=[]
    with tarfile.open(fileobj=io.BytesIO(tarball),mode='r:gz') as archive:
        for count,member in enumerate(archive,1):
            require(count<=100000)
            if member.name=='package/package.json':
                require(member.isfile() and 0<member.size<=1024*1024)
                found.append(archive.extractfile(member).read(member.size+1))
    require(len(found)==1)
    return json.loads(found[0],object_pairs_hook=unique)


@phase('registry-package')
def registry_package(version,read_public):
    package=read_public('https://registry.npmjs.org/veryfront/'+quote(version,safe=''))
    require(package.get('name')=='veryfront' and package.get('version')==version
            and package.get('repository',{}).get('url')==SOURCE_URL)
    return package.get('gitHead'),package.get('dist',{}).get('integrity')


@phase('release-package')
def release_package(version,assets,read_asset):
    # Same facts as the registry record, from the provenance the publishing run
    # attached, bound to the tarball bytes and its packaged manifest.
    provenance_asset=release_asset(assets,'veryfront-'+version+'.npm-provenance.json')
    tarball_asset=release_asset(assets,'veryfront-'+version+'.tgz')
    record=json.loads(asset_bytes(provenance_asset,PROVENANCE_LIMIT,read_asset),object_pairs_hook=unique)
    require(type(record) is dict and set(record)=={'schema_version','package','git_head','repository'}
            and type(record['schema_version']) is int and record['schema_version']==1
            and record['repository']=='https://github.com/veryfront/veryfront-code')
    package=record['package']
    require(type(package) is dict and set(package)=={'name','version','integrity'}
            and package['name']=='veryfront' and package['version']==version)
    origin,integrity=record['git_head'],package['integrity']
    require(type(origin) is str and re.fullmatch(SHA,origin) and type(integrity) is str and re.fullmatch(INTEGRITY,integrity))
    tarball=asset_bytes(tarball_asset,TARBALL_LIMIT,read_asset)
    require('sha512-'+base64.b64encode(hashlib.sha512(tarball).digest()).decode()==integrity)
    manifest=packaged_manifest(tarball)
    require(type(manifest) is dict and manifest.get('name')=='veryfront' and manifest.get('version')==version
            and type(manifest.get('repository')) is dict and manifest['repository'].get('url')==SOURCE_URL
            and manifest.get('gitHead')==origin)
    return origin,integrity,tarball_asset


@phase('input')
def validate_inputs(version,env):
    require(type(version) is str and len(version)<=128 and re.fullmatch(VERSION,version))
    require(env.get('GITHUB_ACTIONS')=='true' and env.get('GITHUB_REPOSITORY')=='veryfront/veryfront-code'
            and env.get('GITHUB_REF')=='refs/heads/main' and env.get('GITHUB_EVENT_NAME') in ('push','workflow_dispatch'))
    sha=env.get('GITHUB_SHA','');require(re.fullmatch(SHA,sha))
    for key in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'):require(re.fullmatch(r'[1-9][0-9]{0,19}',env.get(key,'')))
    # The publishing run's own mode selects the package source; a registry miss
    # never selects the release on its own.
    suspended=env.get('NPM_CORE_PUBLISH_SUSPENDED');require(suspended in ('true','false'))
    return sha,suspended


@phase('package-identity')
def validate_package_identity(origin,integrity):
    require(type(origin) is str and re.fullmatch(SHA,origin)
            and type(integrity) is str and re.fullmatch(INTEGRITY,integrity))
    material=base64.b64decode(integrity[7:],validate=True)
    require(len(material)==64 and base64.b64encode(material).decode()==integrity[7:])


@phase('source-identity')
def validate_source_identity(origin,sha,read_source):
    commit=read_source('repos/veryfront/veryfront-code/commits/'+origin)
    require(commit.get('sha')==origin)
    if origin!=sha:
        comparison=read_source('repos/veryfront/veryfront-code/compare/'+origin+'...'+sha)
        require(comparison.get('status')=='ahead' and comparison.get('base_commit',{}).get('sha')==origin)


def witness(version,env,read_public=public_json,read_source=source_json,read_asset=public_asset):
    sha,suspended=validate_inputs(version,env)
    if suspended=='true':
        release=public_release(version,read_public)
        origin,integrity,package_asset=release_package(version,release['assets'],read_asset)
    else:
        origin,integrity=registry_package(version,read_public)
    validate_package_identity(origin,integrity)
    validate_source_identity(origin,sha,read_source)
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


@phase('material-wait')
def witness_when_ready(version,env,read_public=public_json,read_source=source_json,
                       clock=time.monotonic,sleep=time.sleep,read_asset=public_asset):
    # An unchanged-version main run can overtake the run publishing that version.
    # Wait only for absent public material, never for invalid release facts.
    # The observed publication gap was ten minutes; bound this wait to fifteen.
    deadline=clock()+15*60
    while True:
        try:
            return witness(version,env,read_public,read_source,read_asset)
        except HTTPError as error:
            if error.code!=404:raise
            remaining=deadline-clock()
            if remaining<=0:raise TimeoutError('Code release material was not published within fifteen minutes') from None
            print('Waiting for public Code release material',file=sys.stderr)
            sleep(min(30,remaining))
            if clock()>=deadline:raise TimeoutError('Code release material was not published within fifteen minutes') from None


def main(args,env):
    try:
        require(len(args)==1)
        value=witness_when_ready(args[0],env)
        write_receipt(value)
    except Exception as error:
        print('Code release witness refused; no component receipt issued',file=sys.stderr)
        print('Code release witness diagnostic '+json.dumps(failure_diagnostic(error),sort_keys=True),file=sys.stderr)
        return 1
    return 0


@phase('receipt-write')
def write_receipt(value):
    with open('platform-component.json','x') as output:
        output.write(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n')


if __name__=='__main__':
    raise SystemExit(main(sys.argv[1:],os.environ))
