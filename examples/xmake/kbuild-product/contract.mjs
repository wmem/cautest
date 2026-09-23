import {defineStep} from '@cautest/config';
import {readFile} from 'node:fs/promises';
// This only checks the build contract; it does NOT execute Driver ABI or load a module.
export function create({getArtifact}) {
 return defineStep({kind:'kbuildContract',name:'module-and-kernel',phase:'run',async execute(ctx){
  const module=getArtifact(ctx,'module');const identity=JSON.parse(await readFile(getArtifact(ctx,'identity').path,'utf8'));
  const bytes=await readFile(module.path);const symbols=await readFile(getArtifact(ctx,'symbols').path,'utf8');
  if(bytes.subarray(0,4).toString('hex')!=='7f454c46')throw new Error('Module is not ELF');
  if(identity.arch!=='x86_64'||!identity.release||!bytes.includes(Buffer.from(`vermagic=${identity.release} `)))throw new Error('Module/Kernel release identity mismatch');
  if(!symbols.includes('cautest_demo_value'))throw new Error('Missing exported product symbol');
  return {testResults:[{name:'kbuild-artifact-contract',cases:[{name:'ELF-vermagic-symbols',status:'PASS',assertions:[],diagnostics:[]}]}]};
 }});
}
