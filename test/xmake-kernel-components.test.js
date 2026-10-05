import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdtemp,cp,mkdir,symlink,readFile,writeFile,rm,stat,readdir,appendFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {buildIsolatedKernelModule} from '../dist/kernel/module-build.js';
import {captureKernelContext,consumeKernelModule} from '../dist/kernel/artifact-context.js';
import {resolveArtifact} from '../dist/artifacts/index.js';
import {hashFile} from '../dist/cache/fingerprint.js';
const kit=fileURLToPath(new URL('..',import.meta.url)),xmake=process.env.CAUTEST_XMAKE,kernel=process.env.KERNEL_BUILD;
test('real Kernel Runtime and product/Test modules build through Xmake against explicit host headers (NO UML boot or module load)',{skip:!xmake||!kernel},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ct-module-components-'));try{
  await cp(path.join(kit,'examples/xmake/kernel-driver'),root,{recursive:true});await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');
  const expected=await captureKernelContext(kernel,{arch:'x86_64',target:'vmlinux'});await writeFile(path.join(root,'host-context.json'),JSON.stringify(expected));
  const core=await buildIsolatedKernelModule({module:{name:'cautest_kernel',sourceDir:'kernel/cautest-kernel',sandboxRoot:'.',output:'cautest_kernel.ko'},kernelOutput:kernel,configDir:path.join(kit,'assets/cautest-c'),cacheDir:path.join(root,'cache'),workDir:path.join(root,'work'),arch:'x86_64',signal:AbortSignal.timeout(90000)});
  assert.ok((await stat(core.module)).size>1000);
  const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor',CAUTEST_KERNEL_BUILD:expected.outputDir,CAUTEST_KERNEL_CONTEXT:path.join(root,'host-context.json'),CAUTEST_KERNEL_ARCH:'x86_64',CAUTEST_EXTRA_SYMBOLS:core.symbols};
  function run(args,code=0){const r=spawnSync(xmake,args,{cwd:root,env,encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024});assert.equal(r.status,code,r.stdout+r.stderr);return r;}
  async function sources(){const values=[];async function visit(dir){for(const item of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await visit(file);else values.push([path.relative(root,file),await hashFile(file)]);}}await visit(path.join(root,'product'));return values.sort(([a],[b])=>a.localeCompare(b));}
  const before=await sources();
  for(const target of ['test.kernel','product.driver']){
   run(['build','-y',target]);const desc=path.join(root,'description.json');run(['cautest-artifact',`--target=${target}`,`--output-file=${desc}`]);
   const value=JSON.parse(await readFile(desc,'utf8')),receipt={schemaVersion:2,kind:'cautest.artifact-receipt',target,context:value.context,outputs:await Promise.all(value.outputs.map(async o=>({...o,size:(await stat(o.path)).size})))};
   const resolved=await resolveArtifact(receipt,{target,output:'ko'},value.context,false);const module=await consumeKernelModule(resolved,expected,target.replace('.','-'));assert.ok(module.module.endsWith('.ko'));assert.equal(resolved.receipt.outputs.length,4);
  }
  assert.deepEqual(await sources(),before);assert.deepEqual(await captureKernelContext(kernel,{arch:'x86_64',target:'vmlinux'}),expected);
  await appendFile(path.join(root,'product/driver/cautest_echo.c'),'\n#error injected-product-failure\n');const failed=run(['build','-y','product.driver'],255);assert.match(failed.stdout+failed.stderr,/injected-product-failure/);assert.ok(!(await readdir(path.join(root,'build'))).some(n=>n.startsWith('.module-')));
 }finally{if(!process.env.CAUTEST_KEEP_FIXTURE)await rm(root,{recursive:true,force:true});else console.log(root);}
});
