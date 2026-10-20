"""Prepare authenticated original 0.1.1283 assets without publishing anything.

Run only in a read-only job. Subprocesses which load source or registry code
receive a fresh HOME and an allowlisted environment without App/write tokens.
"""
import argparse
import base64
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import stat
import subprocess
import tarfile
import urllib.parse
import urllib.request
import zipfile
import uuid

HERE=pathlib.Path(__file__).resolve().parent
VERSION='0.1.1283'
SOURCE='8b9eb53979953e4a934014232982cca02eff63b0'


def module(name,filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename)
    loaded=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


verifier=module('original1283_verifier','recover-release-1283.py')
preflight=module('original1283_preflight','recover-release-1283-preflight.py')
require=verifier.require


def file_sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):
            digest.update(block)
    return digest.hexdigest()


def extract_flat(archive_path,destination,expected):
    """Validate the full exact ZIP inventory before writing any entry."""
    require(not destination.exists() and not destination.is_symlink(),'Extraction target exists')
    require(bool(expected),'Empty expected archive inventory')
    with zipfile.ZipFile(archive_path) as archive:
        entries=archive.infolist()
        names=[entry.filename for entry in entries]
        require(len(names)==len(set(names)) and set(names)==set(expected),'Unexpected ZIP inventory')
        for entry in entries:
            path=pathlib.PurePosixPath(entry.filename)
            require(len(path.parts)==1 and not path.is_absolute() and entry.filename not in ('.','..')
                    and '\\' not in entry.filename,'Unsafe ZIP name')
            require(not entry.is_dir() and stat.S_IFMT(entry.external_attr>>16) in (0,stat.S_IFREG)
                    and not entry.flag_bits&1,'Nonregular or encrypted ZIP member')
            require(0<=entry.file_size<=1024**3,'Archive member exceeds bound')
        require(sum(entry.file_size for entry in entries)<=8*1024**3,'Archive exceeds extraction bound')
        destination.mkdir(parents=True)
        for entry in entries:
            with archive.open(entry) as source,(destination/entry.filename).open('xb') as target:
                shutil.copyfileobj(source,target,1024*1024)


def stage_binary(archive,target,assets,expected):
    """Move authenticated raw bytes once; remove only this owned archive/staging dir."""
    require('sha256:'+file_sha(archive)==expected['digest'],'Binary archive changed before extraction')
    extract_flat(archive,target,{expected['name']})
    binary=target/expected['name']
    receipt={'name':expected['name'],'size':binary.stat().st_size,'sha256':file_sha(binary),
             'archiveSha256':expected['digest'].removeprefix('sha256:')}
    destination=assets/expected['name']
    require(not destination.exists() and not destination.is_symlink(),'Binary asset already exists')
    binary.rename(destination)
    require(destination.stat().st_size==receipt['size'] and file_sha(destination)==receipt['sha256'],
            'Moved binary bytes changed')
    archive.unlink()
    target.rmdir()
    return receipt


def validate_signature_audit(audit,expected_names):
    """Require actual npm verification output, including every first-party bundle."""
    require(audit.get('invalid')==[] and audit.get('missing')==[],'npm signature audit has invalid/missing evidence')
    require(isinstance(audit.get('verified'),list),'npm verified attestations missing')
    result=[]
    for name in expected_names:
        rows=[row for row in audit['verified'] if row.get('name')==name and row.get('version')==VERSION]
        require(bool(rows) and all(row.get('attestations') and row.get('attestationBundles') for row in rows),
                'Missing npm-verified attestation bundle: '+name)
        result.append({'name':name,'version':VERSION,'verifiedEntries':len(rows)})
    return result


def normalize_sbom(value,name,commit_timestamp):
    """Stabilize generator metadata for resumable uploads; preserve dependency data."""
    require(value.get('bomFormat')=='CycloneDX','Expected CycloneDX SBOM')
    normalized=json.loads(json.dumps(value))
    normalized.pop('serialNumber',None)
    metadata=normalized.get('metadata')
    require(isinstance(metadata,dict),'SBOM metadata missing')
    metadata.pop('timestamp',None)
    canonical=json.dumps(normalized,sort_keys=True,separators=(',',':'),ensure_ascii=False)
    serial=uuid.uuid5(uuid.NAMESPACE_URL,SOURCE+'\n'+name+'\n'+canonical)
    normalized['serialNumber']='urn:uuid:'+str(serial)
    metadata['timestamp']=commit_timestamp
    return normalized


def runtime_environment(output,parent=None):
    parent=os.environ if parent is None else parent
    environment={key:parent[key] for key in ('PATH','TMPDIR','TMP','TEMP','SYSTEMROOT','COMSPEC','DENO_DIR') if key in parent}
    environment.update({'HOME':str(output/'home'),'USERPROFILE':str(output/'home'),
                        'NPM_CONFIG_USERCONFIG':str(output/'npmrc'),
                        'NPM_CONFIG_GLOBALCONFIG':str(output/'global-npmrc'),
                        'NPM_CONFIG_CACHE':str(output/'npm-cache'),
                        'NPM_CONFIG_REGISTRY':'https://registry.npmjs.org',
                        'NPM_CONFIG_IGNORE_SCRIPTS':'true','CI':'true',
                        'IS_STABLE':'true','STABLE_VERSION':VERSION,'GITHUB_SHA':SOURCE})
    return environment


def run(command,cwd,environment,log,timeout=3600):
    with log.open('w') as target:
        subprocess.run(command,cwd=cwd,env=environment,stdout=target,stderr=subprocess.STDOUT,
                       check=True,timeout=timeout)


def registry_fetch(url,destination=None,max_bytes=32*1024*1024):
    parsed=urllib.parse.urlparse(url)
    require(parsed.scheme=='https' and parsed.hostname=='registry.npmjs.org'
            and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,
            'Unsupported registry URL')
    request=urllib.request.Request(url,headers={'Accept':'application/json'})
    with urllib.request.urlopen(request,timeout=45) as response:
        require(response.url==url,'Registry redirect rejected')
        if destination is None:
            data=response.read(max_bytes+1)
            require(len(data)<=max_bytes,'Registry response exceeds bound')
            return json.loads(data)
        count=0
        with destination.open('xb') as target:
            for block in iter(lambda:response.read(1024*1024),b''):
                count+=len(block)
                require(count<=max_bytes,'Registry tarball exceeds bound')
                target.write(block)
    return None


def download_artifact(plan_item,output,run_id):
    required_free=plan_item['size_in_bytes']+3*1024**3
    require(shutil.disk_usage(output).free>=required_free,'Insufficient free disk for archive, bounded extraction and 2 GiB reserve')
    metadata=preflight.gh_json('repos/'+verifier.REPOSITORY+'/actions/artifacts/'+str(plan_item['id']))
    expected_digest=plan_item.get('digest','sha256:'+plan_item.get('sha256',''))
    for field in ('id','name','size_in_bytes'):
        require(metadata.get(field)==plan_item[field],'Artifact metadata mismatch: '+field)
    require(metadata.get('digest')==expected_digest and metadata.get('expired') is False
            and metadata.get('workflow_run',{}).get('id')==run_id
            and metadata.get('workflow_run',{}).get('head_sha')==SOURCE,'Artifact producer/digest mismatch')
    path=output/(str(plan_item['id'])+'.zip')
    with path.open('xb') as target:
        subprocess.run(['gh','api','repos/'+verifier.REPOSITORY+'/actions/artifacts/'+str(plan_item['id'])+'/zip'],
                       stdout=target,check=True,timeout=1800)
    require(path.stat().st_size==plan_item['size_in_bytes'] and 'sha256:'+file_sha(path)==expected_digest,
            'Downloaded archive digest/size mismatch')
    (output/(str(plan_item['id'])+'.metadata.json')).write_text(json.dumps(metadata,indent=2)+'\n')
    return path


def source_snapshot(source):
    git=lambda *args:subprocess.check_output(['git',*args],cwd=source,text=True).strip()
    require(git('rev-parse','HEAD')==SOURCE,'Source checkout is not original revision')
    require(git('status','--porcelain=v1')=='','Source checkout has modifications')
    locks={}
    for name in git('ls-files').splitlines():
        if name.endswith(('.lock','package-lock.json')):
            locks[name]=file_sha(source/name)
    return {'revision':SOURCE,'tree':git('rev-parse','HEAD^{tree}'),'lockSha256':locks}


def canonical_packages(directory):
    """Called only after the existing canonical verifier has authenticated this directory."""
    manifest=json.loads((directory/'manifest.json').read_text())
    published=[]
    for entry in manifest['packages']:
        with tarfile.open(directory/entry['file']) as archive:
            stream=archive.extractfile('package/package.json')
            require(stream is not None,'Canonical package manifest missing')
            package=json.load(stream)
        if package.get('private') is True or package.get('veryfront',{}).get('npm',{}).get('publish') is False:
            continue
        published.append(entry)
    names=[entry['name'] for entry in published]
    require(len(names)==30 and len(set(names))==30 and 'veryfront' in names,'Unexpected public package inventory')
    return published


def registry_packages(packages,canonical,output):
    records=[]
    output.mkdir()
    for entry in packages:
        name=entry['name']
        slug=entry['file']
        metadata=registry_fetch('https://registry.npmjs.org/'+urllib.parse.quote(name,safe='@/')+'/'+VERSION)
        actual=output/slug
        registry_fetch(metadata.get('dist',{}).get('tarball',''),actual,max_bytes=256*1024*1024)
        expected_bytes=(canonical/slug).read_bytes()
        integrity='sha512-'+base64.b64encode(hashlib.sha512(expected_bytes).digest()).decode('ascii')
        expected={**entry,'gitHead':SOURCE,'integrity':integrity}
        verifier.validate_registry(metadata,actual.read_bytes(),expected)
        attestations=registry_fetch(metadata.get('dist',{}).get('attestations',{}).get('url',''))
        statements=[]
        for attestation in attestations.get('attestations',[]):
            if attestation.get('predicateType')!='https://slsa.dev/provenance/v1':
                continue
            envelope=attestation.get('bundle',{}).get('dsseEnvelope',{})
            require(envelope.get('payloadType')=='application/vnd.in-toto+json','Wrong DSSE payload type')
            statement=json.loads(base64.b64decode(envelope.get('payload',''),validate=True))
            verifier.validate_provenance(statement,'pkg:npm/'+urllib.parse.quote(name,safe='/')+'@'+VERSION,
                                         hashlib.sha512(expected_bytes).hexdigest(),verifier.MAIN_RUN,1,
                                         '.github/workflows/cicd.yml')
            statements.append(statement)
        require(len(statements)==1,'Missing or duplicate SLSA identity statement')
        (output/(slug+'.metadata.json')).write_text(json.dumps(metadata,indent=2)+'\n')
        (output/(slug+'.attestations.json')).write_text(json.dumps(attestations,indent=2)+'\n')
        records.append({'name':name,'version':VERSION,'gitHead':SOURCE,'sha256':entry['sha256'],
                        'integrity':integrity,'tarball':metadata['dist']['tarball'],
                        'decodedProvenanceIdentityVerified':True,'signatureVerifiedByDecoding':False})
    return records


def qualify_installed(records,source,output,environment):
    consumer=output/'registry-consumer'
    consumer.mkdir()
    (consumer/'package.json').write_text(json.dumps({'name':'original1283-read-only-qualification','private':True,
                                                   'dependencies':{row['name']:VERSION for row in records}},indent=2)+'\n')
    node=pathlib.Path(shutil.which('node',path=environment['PATH'])).resolve()
    npm_cli=node.parent.parent/'lib/node_modules/npm/bin/npm-cli.js'
    require(npm_cli.is_file(),'Node 24 bundled npm CLI not found')
    run([str(node),str(npm_cli),'install','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],consumer,
        environment,output/'npm-install.log')
    lock=json.loads((consumer/'package-lock.json').read_text())
    for row in records:
        key='node_modules/'+row['name']
        installed=json.loads((consumer/key/'package.json').read_text())
        require(installed.get('name')==row['name'] and installed.get('version')==VERSION
                and installed.get('gitHead')==SOURCE,'Installed first-party identity mismatch')
        require(lock['packages'][key].get('integrity')==row['integrity']
                and lock['packages'][key].get('resolved')==row['tarball'],'Installed lock identity mismatch')
    run([str(node),str(npm_cli),'audit','signatures','--json','--include-attestations','--registry=https://registry.npmjs.org'],consumer,
        environment,output/'npm-audit-signatures.json')
    audit=json.loads((output/'npm-audit-signatures.json').read_text())
    verified=validate_signature_audit(audit,[row['name'] for row in records])
    (output/'verified-first-party-attestations.json').write_text(json.dumps(verified,indent=2)+'\n')
    run(['bash','scripts/ci/registry-release-smoke.sh'],source,environment,output/'registry-release-smoke.log')
    return verified


def prepare(source,output):
    require(not output.exists(),'Preparation output already exists')
    output.mkdir(parents=True)
    require(shutil.disk_usage(output).free>=8*1024**3,'Less than 8 GiB free')
    plan=json.loads((HERE/'recover-release-1283.json').read_text())
    require(plan['version']==VERSION and plan['source']==SOURCE,'Wrong recovery plan')
    before=source_snapshot(source)
    observation=preflight.observe(plan)
    (output/'read-only-preflight.json').write_text(json.dumps(observation,indent=2)+'\n')
    require(observation['readyForFullQualification'],'Original producer/root not ready')
    environment=runtime_environment(output)
    (output/'home').mkdir()
    for name in ('npmrc','global-npmrc'):
        (output/name).write_text('registry=https://registry.npmjs.org\nignore-scripts=true\n')
    require(subprocess.check_output(['node','--version'],env=environment,text=True).strip().startswith('v24.'),'Node 24 required')
    deno_version=subprocess.check_output(['deno','--version'],env=environment,text=True)
    require(deno_version.splitlines()[0].startswith('deno 2.9.7 '),'Deno 2.9.7 required')
    archives=output/'archives';archives.mkdir()
    npm_zip=download_artifact(plan['npmArtifact'],archives,verifier.TESTED_RUN)
    with zipfile.ZipFile(npm_zip) as archive:
        manifest=json.loads(archive.read('manifest.json'))
        names={'manifest.json',*[entry['file'] for entry in manifest['packages']]}
    canonical=output/'canonical-npm'
    extract_flat(npm_zip,canonical,names)
    run(['deno','run','--allow-read','--allow-run=tar','scripts/ci/npm-compatibility-artifact.ts',
         'verify',str(canonical),SOURCE],source,environment,output/'canonical-verifier.log')
    packages=canonical_packages(canonical)
    records=registry_packages(packages,canonical,output/'registry')
    (output/'registry-byte-and-identity.json').write_text(json.dumps(records,indent=2)+'\n')
    signatures=qualify_installed(records,source,output,environment)
    binaries=output/'binary-extraction';binaries.mkdir()
    assets=output/'assets';assets.mkdir()
    binary_names=[]
    binary_materials=[]
    for item in plan['binaryArtifacts']:
        archive=download_artifact(item,archives,verifier.MAIN_RUN)
        target=binaries/str(item['id'])
        binary_materials.append(stage_binary(archive,target,assets,item))
        (output/'binary-materials.json').write_text(json.dumps(binary_materials,indent=2)+'\n')
        binary_names.append(item['name'])
    sbom=output/'sbom'
    run(['deno','task','sbom:all','--output-dir',str(sbom)],source,environment,output/'sbom-all.log')
    run(['deno','task','sbom','--lock','scripts/build/proxy-deno.lock','--output',str(sbom/'proxy.json')],
        source,environment,output/'sbom-proxy.log')
    commit_epoch=int(subprocess.check_output(['git','show','-s','--format=%ct',SOURCE],cwd=source,text=True).strip())
    commit_timestamp=datetime.datetime.fromtimestamp(commit_epoch,datetime.timezone.utc).isoformat().replace('+00:00','Z')
    sboms=sorted(sbom.glob('*.json'))
    require(len(sboms)==35,'Unexpected original-source SBOM inventory')
    for path in sboms:
        value=json.loads(path.read_text())
        if path.name=='dependencies-by-manifest.json':
            require(isinstance(value.get('manifests'),list),'Invalid dependency index')
        else:
            require(value.get('bomFormat')=='CycloneDX' and value.get('specVersion')=='1.5'
                    and value.get('metadata',{}).get('component',{}).get('version')==VERSION
                    and isinstance(value.get('components'),list),'Invalid generated SBOM')
            value=normalize_sbom(value,path.name,commit_timestamp)
        (assets/path.name).write_text(json.dumps(value,sort_keys=True,indent=2,ensure_ascii=False)+'\n')
    for name in ('install.sh','install.ps1'):
        data=(source/'scripts'/name).read_bytes()
        require(data==subprocess.check_output(['git','show',SOURCE+':scripts/'+name],cwd=source),'Installer source mismatch')
        (assets/name).write_bytes(data)
    (assets/'SHA256SUMS').write_text(''.join(file_sha(assets/name)+'  '+name+'\n'
                                          for name in sorted(binary_names)+['install.sh','install.ps1']))
    require(source_snapshot(source)==before,'Original source/tree/locks changed during preparation')
    entries=[{'name':path.name,'size':path.stat().st_size,'sha256':file_sha(path)} for path in sorted(assets.iterdir())]
    require(len(entries)==45,'Wrong release asset inventory')
    manifest={'schema_version':1,'version':VERSION,'source_revision':SOURCE,'assets':entries}
    manifest_path=output/'manifest.json';manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    receipt={'schemaVersion':1,'scope':'original-release-preparation-only','version':VERSION,'source':before,
             'canonicalNpmArtifactVerified':True,'registryPackages':len(records),'npmVerifiedFirstPartyAttestations':len(signatures),
             'installedRegistrySmokePassed':True,'binaryMaterials':binary_materials,'manifestSha256':file_sha(manifest_path),'assets':entries,
             'sbomSourceRevisionEmbedded':False,
             'sbomMetadataNormalization':{'timestamp':commit_timestamp,'timestampSource':'original-commit-committer-time-UTC',
                                          'serialNumber':'UUIDv5(original-source,filename,canonical-SBOM-without-generated-metadata)',
                                          'dependencyInventoryChanged':False},'sbomBytes':'fresh-supported-generation-from-original-source',
             'published':False,'releaseQualified':False,'stagingQualified':False}
    (output/'preparation-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with pathlib.Path(os.environ['GITHUB_OUTPUT']).open('a') as target:
            target.write('manifest_sha256='+receipt['manifestSha256']+'\n')
    return receipt


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir',required=True,type=pathlib.Path)
    parser.add_argument('--output-dir',required=True,type=pathlib.Path)
    args=parser.parse_args()
    receipt=prepare(args.source_dir.resolve(),args.output_dir.resolve())
    print(json.dumps({'status':'original-release-preparation-passed','manifest_sha256':receipt['manifestSha256'],
                      'published':False,'releaseQualified':False,'stagingQualified':False}))


if __name__=='__main__':
    main()
