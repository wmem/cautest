import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {cp,mkdir,mkdtemp,readFile,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {inspectUmlPrerequisites,reportBlockedUml} from './uml-support.mjs';
const command='npm run test:xmake:uml';
const prerequisites=await inspectUmlPrerequisites();
if(!prerequisites.ok){reportBlockedUml(prerequisites,command);}
else if(!process.env.CAUTEST_XMAKE){reportBlockedUml({problems:[{name:'CAUTEST_XMAKE',reason:'Set a real Xmake executable; no simulator fallback is allowed'}]},command);}
else if(process.platform!=='linux'||process.arch!=='x64'){
 reportBlockedUml({problems:[{name:'host',reason:'The current UML acceptance requires Linux x86_64'}]},command);
}else{
 const kit=fileURLToPath(new URL('../..',import.meta.url));
 const workspace=process.env.CAUTEST_UML_ACCEPTANCE_DIR?path.resolve(process.env.CAUTEST_UML_ACCEPTANCE_DIR):await mkdtemp(path.join(tmpdir(),'cautest-xmake-uml-'));
 await mkdir(workspace,{recursive:true});
 const root=await mkdtemp(path.join(workspace,'project-'));
 await cp(path.join(kit,'examples/xmake/kernel-driver'),root,{recursive:true});await mkdir(path.join(root,'tools'));await symlink(kit,path.join(root,'tools/cautest'),'dir');
 const environment={...process.env,XMAKE_ROOT:'y',XMAKE_COLORTERM:'nocolor',KERNEL_SRC:prerequisites.kernelSource,BUSYBOX_SRC:prerequisites.busyboxSource};
 const records=[];
 function xmake(label,args,timeout=30000){
  const result=spawnSync(process.env.CAUTEST_XMAKE,args,{cwd:root,env:environment,encoding:'utf8',timeout,maxBuffer:128*1024*1024});
  records.push({label,args,exitCode:result.status,signal:result.signal,error:result.error?.message});
  if(result.stderr)process.stderr.write(result.stderr);
  return result;
 }
 try{
  for(const action of ['list','plan']){const result=xmake(action,['ct',`--${action}`,'--json']);assert.equal(result.status,0,result.stdout+result.stderr);const data=JSON.parse(result.stdout);assert.equal(data.length,2);await writeFile(path.join(root,`${action}.json`),result.stdout);}
  const doctor=xmake('doctor',['ct','--doctor','--json']);await writeFile(path.join(root,'doctor.json'),doctor.stdout||doctor.stderr);
  if(doctor.status!==0){
   const report={schemaVersion:1,status:'BLOCKED',code:'uml_environment_not_ready',command,root,doctor:doctor.stdout?JSON.parse(doctor.stdout):doctor.stderr,records};
   await writeFile(path.join(root,'acceptance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=77;
  }else{
   const runs=[];
   for(const label of ['cold','cache-hit']){
    const result=xmake(label,['ct','--json','--reporter=json,junit'],35*60_000);await writeFile(path.join(root,`${label}-stdout.log`),result.stdout);assert.equal(result.status,0,result.stdout+result.stderr);
    const summary=JSON.parse(result.stdout),run=JSON.parse(await readFile(summary.resultPath,'utf8'));assert.equal(run.status,'SUCCESS');assert.equal(run.jobs.length,2);
    for(const job of run.jobs){const cases=job.groups.flatMap(group=>group.cases);assert.ok(cases.length>=2,`${job.jobId} requires real CTP cases`);assert.ok(cases.every(item=>item.status==='PASS'));assert.ok(job.resources.some(item=>item.kind==='uml'&&item.state==='closed'));assert.ok(job.artifacts.some(item=>item.kind==='log'&&item.name.endsWith('-console')));}
    if(label==='cache-hit')for(const job of run.jobs)for(const kind of ['kernelBuild','busyboxBuild']){const step=job.steps.find(item=>item.kind===kind||item.id.startsWith(kind+':'));assert.ok(step?.diagnostics.some(item=>item.code==='cache_hit'),`${job.jobId}/${kind} must hit a byte-validated cache`);}
    runs.push({label,...summary});
   }
   const report={schemaVersion:1,status:'SUCCESS',command,root,runs,records};await writeFile(path.join(root,'acceptance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }
 }catch(error){const report={schemaVersion:1,status:'ERROR',command,root,message:error instanceof Error?error.message:String(error),records};await writeFile(path.join(root,'acceptance.json'),JSON.stringify(report,null,2)+'\n');console.error(JSON.stringify(report,null,2));process.exitCode=2;}
}
