import {register} from "node:module";
import {installInterruptHandling} from "../../runtime/interrupt.js";
register("../../runtime/repository-loader.js",import.meta.url);
const {loadManifest}=await import("./load.js");
const {runCli}=await import("../../runtime/cli.js");
const args=process.argv.slice(2);
const interrupts=installInterruptHandling({onFirst(){process.stderr.write("收到 SIGINT，正在取消并清理；再次按 Ctrl-C 将强制退出\n");}});
try{
 if(args[0]!=="--manifest"||!args[1])throw new Error("Xmake bridge requires --manifest PATH");
 const loadedConfig=await loadManifest(args[1]);
 process.exitCode=await runCli(args.slice(2),process,{signal:interrupts.signal,loadedConfig});
}catch(error){process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=interrupts.signal.aborted?130:3;}
finally{interrupts.close();}
