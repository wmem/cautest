import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,cp,symlink,mkdir,readFile,appendFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const kit=fileURLToPath(new URL('..',import.meta.url));const xmake=process.env.CAUTEST_XMAKE;const kernel=process.env.KERNEL_BUILD;
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};
function run(root,args,code=0){const r=spawnSync(xmake,args,{cwd:root,env,encoding:'utf8',timeout:45000,maxBuffer:16*1024*1024});assert.equal(r.status,code,r.stdout+'\n'+r.stderr);return r;}
test('real product Kbuild phony target exports role-checked ELF, symbols and Kernel identity without source pollution',{skip:!xmake||!kernel},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ct-kbuild-'));try{
  await cp(path.join(kit,'examples/xmake/kbuild-product'),root,{recursive:true});await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');
  run(root,['ct','--list']);run(root,['f','-y',`--kernel_build=${kernel}`]);
  async function result(code=0){const value=JSON.parse(run(root,['ct','--json'],code).stdout);return JSON.parse(await readFile(value.resultPath,'utf8'));}
  const good=await result();assert.equal(good.status,'SUCCESS');assert.equal(good.jobs[0].artifacts.filter(a=>a.kind==='log'&&a.name==='xmake-product.driver').length,1);
  const artifact=good.jobs[0].artifacts.find(a=>a.kind==='build-artifact'&&a.name==='module');assert.equal(artifact.metadata.receipt.outputs.length,4);
  assert.deepEqual((await readdir(path.join(root,'driver'))).sort(),['Makefile','cautest_demo.c']);
  const old=await readFile(artifact.path);run(root,['f','-y',`--kernel_build=${kernel}`,'--demo_value=8']);const changed=await result();assert.notDeepEqual(await readFile(changed.jobs[0].artifacts.find(a=>a.kind==='build-artifact'&&a.name==='module').path),old);
  await appendFile(path.join(root,'driver/cautest_demo.c'),'\n#error injected_driver_build_failure\n');const failed=await result(2);assert.equal(failed.jobs[0].steps.at(-1).status,'SKIPPED');assert.match(JSON.stringify(failed),/injected_driver_build_failure/);assert.deepEqual((await readdir(path.join(root,'driver'))).sort(),['Makefile','cautest_demo.c']);assert.ok(!(await readdir(path.join(root,'build'))).some(n=>n.startsWith('.driver-')));
 }finally{if(!process.env.CAUTEST_KEEP_FIXTURE)await rm(root,{recursive:true,force:true});else console.log(root);}
});
