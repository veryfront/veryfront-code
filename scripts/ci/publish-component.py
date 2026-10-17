"""Read-only Code release witness; no npm/public release write authority.

Publisher CI identity and the npm package's historical source revision are
separate facts. Native asset checksums identify compiled materials; this receipt
is not a compiled-build attestation or a staging qualification result.
"""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

CORE=r'(?:0|[1-9][0-9]*)'
PRE=r'(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
VERSION=rf'{CORE}\.{CORE}\.{CORE}(?:-{PRE}(?:\.{PRE})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?'
SHA=r'[a-f0-9]{40}'


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


def source_json(path):
    require(path.startswith('repos/veryfront/veryfront-code/'))
    projection = '{sha}' if '/commits/' in path else '{status,base_commit:{sha:.base_commit.sha}}'
    result=subprocess.run(['gh','api','--hostname','github.com',path,'--jq',projection],capture_output=True,timeout=60,check=False)
    require(result.returncode==0 and 0<len(result.stdout)<=2*1024*1024)
    return json.loads(result.stdout,object_pairs_hook=unique)


def witness(version,env,read_public=public_json,read_source=source_json):
    require(type(version) is str and len(version)<=128 and re.fullmatch(VERSION,version))
    require(env.get('GITHUB_ACTIONS')=='true' and env.get('GITHUB_REPOSITORY')=='veryfront/veryfront-code'
            and env.get('GITHUB_REF')=='refs/heads/main' and env.get('GITHUB_EVENT_NAME') in ('push','workflow_dispatch'))
    sha=env.get('GITHUB_SHA','');require(re.fullmatch(SHA,sha))
    for key in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'):require(re.fullmatch(r'[1-9][0-9]{0,19}',env.get(key,'')))
    package=read_public('https://registry.npmjs.org/veryfront/'+quote(version,safe=''))
    require(package.get('name')=='veryfront' and package.get('version')==version
            and package.get('repository',{}).get('url')=='git+https://github.com/veryfront/veryfront-code.git')
    integrity=package.get('dist',{}).get('integrity');origin=package.get('gitHead')
    require(type(origin) is str and re.fullmatch(SHA,origin)
            and type(integrity) is str and re.fullmatch(r'sha512-[A-Za-z0-9+/]{86}==',integrity))
    material=base64.b64decode(integrity[7:],validate=True)
    require(len(material)==64 and base64.b64encode(material).decode()==integrity[7:])
    commit=read_source('repos/veryfront/veryfront-code/commits/'+origin)
    require(commit.get('sha')==origin)
    if origin!=sha:
        comparison=read_source('repos/veryfront/veryfront-code/compare/'+origin+'...'+sha)
        require(comparison.get('status')=='ahead' and comparison.get('base_commit',{}).get('sha')==origin)
    release=read_public('https://api.github.com/repos/veryfront/veryfront/releases/tags/v'+quote(version,safe=''))
    require(type(release.get('id')) is int and release['id']>0 and release.get('draft') is False
            and release.get('tag_name')=='v'+version)
    assets=release.get('assets');require(type(assets) is list and len(assets)<=1000)
    binaries={}
    for platform,architecture in [('linux/amd64','x64'),('linux/arm64','arm64')]:
        roles={}
        for role,prefix in [('renderer','veryfront'),('proxy','veryfront-proxy')]:
            name=prefix+'-linux-'+architecture
            found=[asset for asset in assets if asset.get('name')==name]
            require(len(found)==1)
            asset=found[0]
            require(type(asset.get('id')) is int and asset['id']>0 and type(asset.get('size')) is int and asset['size']>0
                    and type(asset.get('digest')) is str and re.fullmatch(r'sha256:[a-f0-9]{64}',asset['digest']))
            roles[role]={'asset_id':asset['id'],'name':name,'digest':asset['digest'],'size':asset['size']}
        binaries[platform]=roles
    return {'schema_version':1,'component':'code',
            'source':{'repository':'veryfront/veryfront-code','sha':sha,
                      'ci_run_id':int(env['GITHUB_RUN_ID']),'ci_run_attempt':int(env['GITHUB_RUN_ATTEMPT'])},
            'configuration':{'source_revision':sha},
            'release':{'repository':'veryfront/veryfront','release_id':release['id'],'version':version,
                       'package_source_revision':origin,
                       'package':{'name':'veryfront','version':version,'integrity':integrity},'binaries':binaries}}


if __name__=='__main__':
    try:
        require(len(sys.argv)==2)
        value=witness(sys.argv[1],os.environ)
        with open('platform-component.json','x') as output:output.write(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n')
    except Exception:
        print('Code release witness refused; no component receipt issued',file=sys.stderr)
        raise SystemExit(1)
