import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {createPortableTree,verifyPortableTree,readBuildInfo} from '../dist/portable.js';
const kit=fileURLToPath(new URL('..',import.meta.url));const xmake=process.env.CAUTEST_XMAKE;
test('real portable Xmake Native and MCU execute after relocation with no dist or node_modules',{skip:!xmake},async()=>{
 const base=await mkdtemp(path.join(tmpdir(),'ct-portable-中文-'));
 try{
  const build=spawnSync(process.execPath,['dist/build-info.js'],{cwd:kit,encoding:'utf8'});assert.equal(build.status,0,build.stderr);
  for(const kind of ['native','mcu-simulated','mcu-spi-simulated']){
   const root=path.join(base,kind);await cp(path.join(kit,'examples/xmake',kind),root,{recursive:true});const portable=path.join(root,'tools/cautest');await mkdir(portable,{recursive:true});await createPortableTree(portable,await readBuildInfo());await verifyPortableTree(portable);
   await assert.rejects(stat(path.join(portable,'dist')));await assert.rejects(stat(path.join(portable,'node_modules')));
   const r=spawnSync(xmake,['ct','--json','--reporter=json,junit'],{cwd:root,env:{...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'},encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);
   const result=JSON.parse(await readFile(JSON.parse(r.stdout).resultPath,'utf8'));assert.equal(result.status,'SUCCESS');assert.equal(result.jobs.length,kind==='mcu-simulated'?1:2);await verifyPortableTree(portable);
  }
 }finally{await rm(base,{recursive:true,force:true});}
});


test('portable Kernel/Driver factory plans and static Guest builds without source dist or dependencies (NO UML boot)', {skip: !xmake}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ct-portable-kernel-中文-'));
  try {
    await cp(path.join(kit, 'examples/xmake/kernel-driver'), root, {recursive: true});
    const portable = path.join(root, 'tools/cautest');
    await mkdir(portable, {recursive: true});
    await createPortableTree(portable, await readBuildInfo());
    await assert.rejects(stat(path.join(portable, 'dist')));
    await assert.rejects(stat(path.join(portable, 'node_modules')));
    const env = {...process.env, XMAKE_ROOT: 'y', XMAKE_COLORTERM: 'nocolor'};
    function run(args) {
      const result = spawnSync(xmake, args, {cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024});
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return result;
    }
    const jobs = JSON.parse(run(['ct', '--list', '--json']).stdout);
    assert.equal(jobs.length, 2);
    const plan = JSON.parse(run(['ct', '--plan', '--json']).stdout);
    assert.ok(plan.every(job => job.workflow.some(step => step.kind === 'umlStart')));
    await assert.rejects(stat(path.join(root, 'build')));
    await assert.rejects(stat(path.join(root, '.cautest/cache')));
    run(['build', '-y', 'test.driver-guest']);
    const description = path.join(root, 'guest-description.json');
    run(['cautest-artifact', '--target=test.driver-guest', `--output-file=${description}`]);
    const receipt = JSON.parse(await readFile(description, 'utf8'));
    const primary = receipt.outputs.find(output => output.role === 'primary') ?? receipt.outputs[0];
    const headers = spawnSync('readelf', ['-l', primary.path], {encoding: 'utf8'});
    assert.equal(headers.status, 0, headers.stderr);
    assert.doesNotMatch(headers.stdout, /INTERP/);
    assert.ok(receipt.protocolBuildId);
    await verifyPortableTree(portable);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
