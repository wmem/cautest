import {spawnSync} from 'node:child_process';
const kbuild=process.argv.includes('--kbuild'),matrix=process.argv.includes('--matrix');
if(kbuild&&matrix){console.error('Choose one explicit acceptance suite');process.exit(2);}
if(!process.env.CAUTEST_XMAKE || (kbuild&&!process.env.KERNEL_BUILD)){
 console.error(kbuild?'Set CAUTEST_XMAKE and KERNEL_BUILD to run real Kbuild acceptance. No skipped suite is treated as PASS.':'Set CAUTEST_XMAKE to the real Xmake 3.1.1 executable. No skipped suite is treated as PASS.');process.exit(2);
}
if(process.platform!=='linux'||process.arch!=='x64'){console.error('This acceptance suite is currently verified only on Linux x86_64.');process.exit(2);}
const files=matrix?['test/xmake-build-matrix.test.js']:kbuild?['test/xmake-kbuild.test.js','test/xmake-kernel-components.test.js']:['test/xmake-poc.test.js','test/xmake-concurrency.test.js','test/xmake-adapter.test.js','test/xmake-robustness.test.js','test/xmake-mcu.test.js','test/xmake-spi-simulated.test.js','test/xmake-delivery.test.js','test/xmake-kernel.test.js'];
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',env:process.env});
if(result.error){console.error(result.error.message);process.exitCode=2;}else process.exitCode=result.status??2;
