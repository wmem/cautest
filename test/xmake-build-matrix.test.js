import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdtemp,mkdir,symlink,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const kit=fileURLToPath(new URL('..',import.meta.url)),xmake=process.env.CAUTEST_XMAKE;
const env={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor'};
function command(root,args){const r=spawnSync(xmake,args,{cwd:root,env,encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stdout+r.stderr+String(r.error??''));return r;}
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'ct-build-matrix-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');return root;}
async function execute(root){const value=JSON.parse(command(root,['ct','--json','--reporter=json,junit']).stdout);const run=JSON.parse(await readFile(value.resultPath,'utf8'));assert.equal(run.status,'SUCCESS');return run.jobs[0].artifacts.find(item=>item.kind==='build-artifact');}
test('real Xmake public/interface/private compile configuration and public link dependencies preserve product boundaries',{skip:!xmake},async t=>{
 const root=await fixture(t);for(const kind of ['private','public','interface'])await mkdir(path.join(root,kind));
 await writeFile(path.join(root,'private/private.h'),'#define PRIVATE_HEADER 11\n');await writeFile(path.join(root,'public/public.h'),'#define PUBLIC_HEADER 13\n');await writeFile(path.join(root,'interface/interface.h'),'#define INTERFACE_HEADER 17\n');
 await writeFile(path.join(root,'lib.c'),`#include "private.h"\n#include "public.h"\n#include <math.h>\n#if !defined(LIB_PRIVATE) || !defined(LIB_PUBLIC) || defined(LIB_INTERFACE) || defined(TEST_ONLY)\n#error product compile visibility changed\n#endif\nint product_value(void){return PRIVATE_HEADER+PUBLIC_HEADER+LIB_PRIVATE+LIB_PUBLIC;}\ndouble product_sqrt(double x){return sqrt(x);}\n`);
 await writeFile(path.join(root,'test.c'),`#include <cautest/cautest.h>\n#include "public.h"\n#include "interface.h"\n#if defined(LIB_PRIVATE) || !defined(LIB_PUBLIC) || !defined(LIB_INTERFACE) || !defined(TEST_ONLY)\n#error consumer visibility wrong\n#endif\nint product_value(void);double product_sqrt(double);\nCAUTEST_CASE(boundaries){CAUTEST_EXPECT_EQ_INT(48,product_value());CAUTEST_EXPECT_EQ_INT(30,PUBLIC_HEADER+INTERFACE_HEADER);CAUTEST_EXPECT_EQ_INT(3,(int)product_sqrt(9.0));}\nCAUTEST_SUITE(visibility,CAUTEST_CASE_ENTRY(boundaries));\n`);
 await writeFile(path.join(root,'xmake.lua'),`set_project("visibility")\nset_languages("c11")\nincludes("tools/cautest/xmake.lua")\ntarget("product")\nset_kind("static")\nset_default(false)\nadd_files("lib.c")\nadd_includedirs("private")\nadd_includedirs("public",{public=true})\nadd_includedirs("interface",{interface=true})\nadd_defines("LIB_PRIVATE=11")\nadd_defines("LIB_PUBLIC=13",{public=true})\nadd_defines("LIB_INTERFACE=17",{interface=true})\nadd_links("m",{public=true})\nadd_ldflags("-Wl,--no-undefined",{public=true})\ntarget_end()\ntarget("test.visibility")\nset_kind("binary")\nset_default(false)\nadd_rules("cautest.native")\nadd_deps("product")\nadd_defines("TEST_ONLY=1")\nadd_files("test.c")\nadd_values("cautest.registry.suites","visibility")\ntarget_end()\nctest.native {id="unit.visibility",target="test.visibility"}\n`);
 const release=await execute(root);command(root,['f','-y','-m','debug']);const debug=await execute(root);assert.notEqual(debug.path,release.path);assert.notEqual(debug.buildId,release.buildId);
 const result=JSON.parse(command(root,['ct','--describe','--json']).stdout);assert.ok(JSON.stringify(result).includes('unit.visibility'));
});
test('real native compiler/config transitions cannot reuse the prior compiler receipt',{skip:!xmake},async t=>{
 const root=await fixture(t);await writeFile(path.join(root,'test.c'),'#include <cautest/cautest.h>\nCAUTEST_CASE(ok){CAUTEST_EXPECT_EQ_INT(1,1);}\nCAUTEST_SUITE(matrix,CAUTEST_CASE_ENTRY(ok));\n');
 await writeFile(path.join(root,'xmake.lua'),'includes("tools/cautest/xmake.lua")\ntarget("test.matrix")\nset_kind("binary")\nadd_rules("cautest.native")\nadd_files("test.c")\nadd_values("cautest.registry.suites","matrix")\ntarget_end()\nctest.native {id="unit.matrix",target="test.matrix"}\n');
 command(root,['f','-y','--toolchain=gcc']);const gcc=await execute(root);assert.ok(gcc.metadata.receipt.context.configDigest);
 // Compiler availability is a required precondition of this explicit matrix, not a silent skip.
 const clangCheck=spawnSync('clang',['--version'],{encoding:'utf8'});assert.equal(clangCheck.status,0,'This matrix requires actual clang in PATH');
 command(root,['f','-y','--toolchain=clang']);const clang=await execute(root);assert.notEqual(clang.buildId,gcc.buildId);assert.notEqual(clang.metadata.receipt.context.configDigest,gcc.metadata.receipt.context.configDigest);
 command(root,['f','-y','--toolchain=gcc','-o','alternate-build']);const alternate=await execute(root);assert.notEqual(alternate.path,gcc.path);assert.ok(alternate.path.includes('alternate-build'));assert.ok((await stat(alternate.path)).size>0);
});
test('real 100/1000/2000-job list/filter measures command-tree peak RSS and emits no build artifacts',{skip:!xmake},async t=>{
 const root=await fixture(t);await writeFile(path.join(root,'xmake.lua'),'includes("tools/cautest/xmake.lua")\nincludes("ctest.lua")\n');
 await mkdir(path.join(root,'fragments'));await writeFile(path.join(root,'ctest.lua'),'ctest.include {patterns={"fragments/*.lua"}}\n');
 const measurements=[];
 for(const count of [100,1000,2000]){
  for(let group=0;group<20;group++){const lines=[];for(let i=group;i<count;i+=20)lines.push(`ctest.native {id="unit.scale.${String(i).padStart(5,'0')}",target="not-built",tags={"scale","${i%2?'odd':'even'}"}}`);await writeFile(path.join(root,'fragments',String(group).padStart(2,'0')+'.lua'),lines.join('\n'));}
  const usage=path.join(root,'usage.txt'),started=performance.now();const r=spawnSync('/usr/bin/time',['-f','%M','-o',usage,xmake,'ct','--json','--list','--tag=scale,even'],{cwd:root,env,encoding:'utf8',timeout:20000,maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);const jobs=JSON.parse(r.stdout);assert.equal(jobs.length,count/2);const rss=Number((await readFile(usage,'utf8')).trim());assert.ok(rss>0);measurements.push({jobs:count,selected:jobs.length,elapsedMs:Math.round(performance.now()-started),peakRssKiB:rss});await assert.rejects(stat(path.join(root,'build')));
 }
 // A deliberately loose smoke bound avoids pretending these host measurements are a benchmark.
 assert.ok(measurements[2].elapsedMs<20000);assert.ok(measurements[2].peakRssKiB<768*1024);console.log('Xmake discovery measurements (GNU time max RSS, not sum of simultaneous processes)',JSON.stringify(measurements));
});

test('real 1024 C cases across 16 suites reuse one product artifact and preserve selected runtime counts', {skip: !xmake}, async t => {
 const root=await fixture(t), suites=[];
 await mkdir(path.join(root,'cases'));
 for(let suite=0;suite<16;suite++){
  const name='scale_'+String(suite).padStart(2,'0');suites.push(name);
  const lines=['#include <cautest/cautest.h>'];
  for(let i=0;i<64;i++)lines.push(`CAUTEST_CASE(check_${String(i).padStart(2,'0')}){CAUTEST_EXPECT_EQ_INT(${suite+i},${suite}+${i});}`);
  lines.push(`CAUTEST_SUITE(${name},${Array.from({length:64},(_,i)=>`CAUTEST_CASE_ENTRY(check_${String(i).padStart(2,'0')})`).join(',')});`);
  await writeFile(path.join(root,'cases',name+'.c'),lines.join('\n'));
 }
 await writeFile(path.join(root,'xmake.lua'),`includes("tools/cautest/xmake.lua")
target("test.large-catalog")
set_kind("binary")
set_default(false)
add_rules("cautest.native")
add_files("cases/*.c")
add_values("cautest.registry.suites",${suites.map(s=>JSON.stringify(s)).join(',')})
add_values("cautest.workspaceSize",4*1024*1024)
target_end()
ctest.native {id="unit.catalog.a",target="test.large-catalog",run={suite={${suites.slice(0,8).map(JSON.stringify).join(',')}}}}
ctest.native {id="unit.catalog.b",target="test.large-catalog",run={suite={${suites.slice(8).map(JSON.stringify).join(',')}}}}
`);
 const usage=path.join(root,'case-rss.txt'),started=performance.now();
 const measured=spawnSync('/usr/bin/time',['-f','%M','-o',usage,xmake,'ct','--json','--reporter=json,junit'],{cwd:root,env,encoding:'utf8',timeout:90000,maxBuffer:32*1024*1024});
 assert.equal(measured.status,0,measured.stdout+measured.stderr+String(measured.error??''));
 const summary=JSON.parse(measured.stdout), result=JSON.parse(await readFile(summary.resultPath,'utf8'));
 assert.equal(result.status,'SUCCESS');assert.equal(result.jobs.length,2);
 const cases=result.jobs.flatMap(j=>j.groups.flatMap(g=>g.cases));assert.equal(cases.length,1024);assert.ok(cases.every(c=>c.status==='PASS'));
 assert.equal(result.jobs.flatMap(j=>j.artifacts.filter(a=>a.kind==='log'&&a.name==='xmake-test.large-catalog')).length,1);
 const artifact=result.jobs[0].artifacts.find(a=>a.kind==='build-artifact'), before=await stat(artifact.path);
 const filtered=JSON.parse(command(root,['ct','--json','--case=check_00','unit.catalog.a']).stdout);
 const selected=JSON.parse(await readFile(filtered.resultPath,'utf8'));assert.equal(selected.jobs.flatMap(j=>j.groups.flatMap(g=>g.cases)).length,8);
 assert.equal(selected.jobs[0].artifacts.find(a=>a.kind==='build-artifact').buildId,artifact.buildId);assert.equal((await stat(artifact.path)).mtimeMs,before.mtimeMs);
 const junit=await readFile(path.join(path.dirname(summary.resultPath),'junit.xml'),'utf8');assert.equal((junit.match(/<testcase\b/gu)??[]).length,1024);
 console.log('Large runtime catalog measurement',JSON.stringify({suites:16,cases:1024,elapsedMs:Math.round(performance.now()-started),peakRssKiB:Number((await readFile(usage,'utf8')).trim())}));
});
