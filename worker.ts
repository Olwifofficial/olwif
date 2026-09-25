import handler from "vinext/server/fetch-handler";
import {runMemberMonitor} from "./lib/member-monitor";
const worker = {
 fetch:handler.fetch,
 async scheduled(_event:ScheduledController,_env:unknown,ctx:ExecutionContext){ctx.waitUntil(runMemberMonitor({scheduled:true}));}
};
export default worker;
