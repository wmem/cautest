import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,symlink,mkdir,readFile,writeFile,appendFile,rm,stat,rename,readdir,utimes} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const kit=fileURLToPath(new URL('..',import.meta.url));const xmake=process.env.CAUTEST_XMAKE;
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};const when={skip:!xmake};
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'cautest 深入 ;$ '));try{await cp(path.join(kit,'examples/xmake/native'),root,{recursive:true});await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');await fn(root);}finally{if(process.env.CAUTEST_KEEP_FIXTURE)console.log("FIXTURE",root);else await rm(root,{recursive:true,force:true});}}
function run(root,args,code=0,extra={}){const r=spawnSync(xmake,args,{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:25000,maxBuffer:32*1024*1024});assert.equal(r.status,code,r.stdout+'\n'+r.stderr+'\n'+(r.error??''));return r;}
function json(root,args,code=0){return JSON.parse(run(root,['ct','--json',...args],code).stdout);}
async function result(root,args=[],code=0){return JSON.parse(await readFile(json(root,['--reporter=json,junit',...args],code).resultPath,'utf8'));}
const artifact=j=>j.artifacts.find(a=>a.kind==='build-artifact');
async function alive(pid){try{const text=await readFile(`/proc/${pid}/stat`,'utf8');return !text.slice(text.lastIndexOf(')')+2).startsWith('Z');}catch{return false;}}
test('real outer SIGINT cancels nested build and reaps a pipe-detached compiler grandchild',when,()=>fixture(async root=>{
 const pidfile=path.join(root,'slow.pid');await writeFile(path.join(root,'slow.mjs'),`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const c=spawn('/bin/sleep',['60'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidfile)},String(c.pid));setInterval(()=>{},1000);`);
 await appendFile(path.join(root,'ctest.lua'),`\ntarget("slow")\n set_kind("phony")\n on_build(function() os.execv(${JSON.stringify(process.execPath)}, {"slow.mjs"}) end)\n add_values("cautest.outputs","primary=unused.bin")\ntarget_end()\nctest.workflow {id="integration.cancel", provider={module="cancel.mjs",export="create"},artifacts={app={target="slow"}}}\n`);
 await writeFile(path.join(root,'cancel.mjs'),`import {defineStep} from '@cautest/config';export function create(){return defineStep({kind:'notReached',phase:'run',execute(){throw new Error('MUST NOT RUN');}});}`);
 const child=spawn(xmake,['ct','--json','integration.cancel'],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const exited=new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
 let pid;try{for(let i=0;i<200;i++){try{pid=Number(await readFile(pidfile,'utf8'));break;}catch{await delay(25);}}assert.ok(pid,err+out);assert.equal(await alive(pid),true);process.kill(-child.pid,'SIGINT');const end=await Promise.race([exited,delay(5000).then(()=>({timeout:true}))]);assert.ok(end.code===130||end.signal==='SIGINT',JSON.stringify(end)+'\n'+out+err);for(let i=0;i<40&&await alive(pid);i++)await delay(25);assert.equal(await alive(pid),false,'compiler grandchild leaked');const r=JSON.parse(out);const data=JSON.parse(await readFile(r.resultPath,'utf8'));assert.equal(data.status,'ERROR');assert.equal(data.jobs[0].steps[1].status,'SKIPPED');}finally{try{process.kill(-child.pid,'SIGKILL');}catch{}if(pid)try{process.kill(pid,'SIGKILL');}catch{}}
}));
test('real generation dependency, mocks and conditional source selection take effect on first build',when,()=>fixture(async root=>{
 await writeFile(path.join(root,'value.txt'),'42');await writeFile(path.join(root,'mock.c'),'int sensor_read(void){return 42;}\n');await writeFile(path.join(root,'real.c'),'int sensor_read(void){return -1;}\n');
 await writeFile(path.join(root,'generated_test.c'),'#include <cautest/cautest.h>\n#include "value.h"\nint sensor_read(void);\nCAUTEST_CASE(value){CAUTEST_EXPECT_EQ_INT(CONFIG_VALUE,sensor_read());}\nCAUTEST_SUITE(generated_test,CAUTEST_CASE_ENTRY(value));\n');
 await appendFile(path.join(root,'ctest.lua'),`\ntarget("generate.config")\n set_kind("phony")\n set_policy("build.fence",true)\n on_build(function ()\n  os.mkdir("generated")\n  local text="#define CONFIG_VALUE " .. io.readfile("value.txt") .. "\\n"\n  if not os.isfile("generated/value.h") or io.readfile("generated/value.h")~=text then io.writefile("generated/value.h",text) end\n end)\ntarget_end()\ntarget("test.generated")\n set_kind("binary")\n set_default(false)\n add_rules("cautest.native")\n add_deps("generate.config")\n add_includedirs("generated")\n add_files("generated_test.c")\n if is_plat("linux") then add_files("mock.c") else add_files("real.c") end\n add_values("cautest.registry.suites","generated_test")\ntarget_end()\nctest.native {id="unit.generated",target="test.generated"}\n`);
 const first=await result(root,['unit.generated']);const old=artifact(first.jobs[0]);await writeFile(path.join(root,'value.txt'),'43');await writeFile(path.join(root,'mock.c'),'int sensor_read(void){return 43;}\n');const next=await result(root,['unit.generated']);assert.notEqual(artifact(next.jobs[0]).buildId,old.buildId);assert.equal(next.status,'SUCCESS');
 const oldTime=await stat(path.join(root,'mock.c'));
 for(const value of [44,45,46]){await writeFile(path.join(root,'value.txt'),String(value));await writeFile(path.join(root,'mock.c'),`int sensor_read(void){return ${value};}\n`);await utimes(path.join(root,'mock.c'),oldTime.atime,oldTime.mtime);assert.equal((await result(root,['unit.generated'])).status,'SUCCESS');}
}));
test('real 100/1000 job discovery, fragment addition/removal, changed cwd and deterministic config digest',when,()=>fixture(async root=>{
 await writeFile(path.join(root,'ctest.lua'),'ctest.include {patterns={"fragments/*.lua"}}\n');await mkdir(path.join(root,'fragments'));
 const fill=async(n)=>{for(const file of await readdir(path.join(root,'fragments')))await rm(path.join(root,'fragments',file));for(let file=0;file<10;file++){let text='';for(let job=0;job<n/10;job++)text+=`ctest.native {id="unit.scale.${String(file*100+job).padStart(4,'0')}",target="none",tags={"scale"}}\n`;await writeFile(path.join(root,'fragments',`${String(file).padStart(2,'0')}.lua`),text);}};
 const timings=[];for(const n of [100,1000]){await fill(n);const start=performance.now();const listed=json(root,['--list']);timings.push({jobs:n,elapsedMs:performance.now()-start});assert.equal(listed.length,n);assert.deepEqual(listed.map(j=>j.id),[...listed.map(j=>j.id)].sort());}
 const stable=value=>{const {config,...rest}=value;return rest;};const first=stable(json(root,['--describe']));assert.deepEqual(stable(json(root,['--describe'])),first);
 const moved=run(tmpdir(),['ct',`--project=${root}`,'--json','--list']);assert.equal(JSON.parse(moved.stdout).length,1000);
 await writeFile(path.join(root,'fragments','new.lua'),'ctest.native {id="unit.new",target="none"}\n');assert.equal(json(root,['--list']).length,1001);assert.notDeepEqual(stable(json(root,['--describe'])),first);await rm(path.join(root,'fragments','new.lua'));assert.deepEqual(stable(json(root,['--describe'])),first);
 console.log('Xmake scale measurements',JSON.stringify(timings));await assert.rejects(stat(path.join(root,'build')));
}));
test('real mode/output isolation, profile env and strict registry C symbols',when,()=>fixture(async root=>{
 const release=await result(root,['unit.math']);run(root,['f','-y','-m','debug']);const debug=await result(root,['unit.math']);assert.notEqual(artifact(debug.jobs[0]).path,artifact(release.jobs[0]).path);assert.notEqual(artifact(debug.jobs[0]).buildId,artifact(release.jobs[0]).buildId);
 await result(root,['--test-profile=ci','unit.math']);
 const file=path.join(root,'modules/math/test.lua');await writeFile(file,(await readFile(file,'utf8')).replace('"math_test", "math_second"','"math_*"'));const invalid=await result(root,['unit.math'],2);assert.match(JSON.stringify(invalid),/C Suite symbol/);
}));
test('real Native richer fixtures retain PASS/FAIL/ERROR/SKIP and parameterized results',when,()=>fixture(async root=>{
 await cp(path.join(kit,'test/fixtures/native/native_cases.c'),path.join(root,'cases.c'));await appendFile(path.join(root,'ctest.lua'),'\ntarget("test.cases")\nset_kind("binary")\nset_default(false)\nadd_rules("cautest.native")\nadd_files("cases.c")\nadd_values("cautest.registry.suites","native_cases","snapshot_cases")\ntarget_end()\nctest.native {id="unit.cases",target="test.cases"}\n');
 const r=await result(root,['unit.cases'],2);const cases=r.jobs[0].groups.flatMap(g=>g.cases);for(const status of ['PASS','FAIL','ERROR','SKIP'])assert.ok(cases.some(c=>c.status===status),JSON.stringify(cases));assert.ok(cases.length>5);
}));
