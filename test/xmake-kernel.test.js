import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdtemp,cp,mkdir,symlink,readFile,writeFile,appendFile,rm,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolveArtifact} from '../dist/artifacts/index.js';
import {consumeDriverGuest} from '../dist/kernel/artifact-context.js';
import {hashFile} from '../dist/cache/fingerprint.js';
const kit=fileURLToPath(new URL('..',import.meta.url)), xmake=process.env.CAUTEST_XMAKE;
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};
function run(root,args,expected=0){const result=spawnSync(xmake,args,{cwd:root,env,encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024});assert.equal(result.status,expected,result.stdout+'\n'+result.stderr);return result;}
test('real Xmake Kernel/Driver declarations are side-effect-free and the independent static guest rule builds and speaks CTP',{skip:!xmake},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ct-xmake-kernel-'));try{
  await cp(path.join(kit,'examples/xmake/kernel-driver'),root,{recursive:true});await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');
  const list=JSON.parse(run(root,['ct','--list','--json']).stdout);assert.equal(list.length,2);
  const plan=JSON.parse(run(root,['ct','--plan','--json']).stdout);assert.ok(plan.every(j=>j.workflow.some(s=>s.kind==='umlStart')));assert.ok(!JSON.stringify(plan).includes('xmakeUnsupported'));
  await assert.rejects(stat(path.join(root,'build')));await assert.rejects(stat(path.join(root,'.cautest/cache')));
  run(root,['build','-y','test.driver-guest']);
  const description=path.join(root,'guest-artifact.json');run(root,['cautest-artifact','--target=test.driver-guest',`--output-file=${description}`]);
  const info=JSON.parse(await readFile(description,'utf8'));
  const receipt={schemaVersion:2,kind:'cautest.artifact-receipt',target:info.target,context:info.context,protocolBuildId:info.protocolBuildId,outputs:await Promise.all(info.outputs.map(async output=>({...output,size:(await stat(output.path)).size})))};
  const artifact=await resolveArtifact(receipt,{target:'test.driver-guest'},info.context,true);assert.equal((await consumeDriverGuest(artifact,'driver-guest')).buildId,info.protocolBuildId);
  await cp(path.join(kit,'test/fixtures/native/smoke_test.c'),path.join(root,'smoke.c'));
  await appendFile(path.join(root,'ctest.lua'),'\ntarget("test.guest-smoke")\nset_kind("binary")\nset_default(false)\nadd_rules("cautest.driver-guest")\nadd_files("smoke.c")\nadd_values("cautest.registry.suites","smoke")\ntarget_end()\nctest.native {id="unit.guest-smoke",target="test.guest-smoke"}\n');
  const summary=JSON.parse(run(root,['ct','--json','--case=passes','unit.guest-smoke']).stdout), result=JSON.parse(await readFile(summary.resultPath,'utf8'));assert.equal(result.status,'SUCCESS');assert.equal(result.jobs.length,1);
  await assert.rejects(stat(path.join(root,'build/modules')),'Unselected Driver/Kernel targets must not be built');
  await appendFile(path.join(root,'smoke.c'),'\n#error guest-build-failure\n');const failedSummary=JSON.parse(run(root,['ct','--json','--case=passes','unit.guest-smoke'],2).stdout), failed=JSON.parse(await readFile(failedSummary.resultPath,'utf8'));assert.equal(failed.status,'ERROR');assert.match(JSON.stringify(failed),/guest-build-failure/);assert.equal(failed.jobs[0].steps.at(-1).status,'SKIPPED');
 }finally{if(!process.env.CAUTEST_KEEP_FIXTURE)await rm(root,{recursive:true,force:true});else console.log(root);}
});
