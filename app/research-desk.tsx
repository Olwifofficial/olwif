"use client";
import {useState,useEffect,useRef,useCallback} from "react";
import {ArrowUpRight,Search,LoaderCircle} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from "@/components/ui/select";
import SiteShell from "./site-shell";
import ResearchOwl from "@/components/research-owl";
import SupportedNetworks from "@/components/supported-networks";
import {NETWORKS} from "@/lib/security";
type ModelContext={registerTool:(tool:Record<string,unknown>,options?:{signal:AbortSignal})=>void|Promise<void>};
export default function ResearchDesk({notice=""}:{notice?:string}){
 const [query,setQuery]=useState("");const [chain,setChain]=useState("auto");
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const pending=useRef<AbortController|null>(null);
 const check=useCallback(async(value:string,network:string)=>{
 if(pending.current)throw new Error("A check is already running.");
 if(!value.trim())throw new Error("Paste the complete token address first.");
 const controller=new AbortController();pending.current=controller;setBusy(true);setError("");setQuery(value);setChain(network);
 const timer=setTimeout(()=>controller.abort(),55000);
 try{const response=await fetch("/api/research",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:value,chain:network}),signal:controller.signal});
 const data=await response.json() as {id:string,error?:string,cached:boolean};if(!response.ok)throw new Error(data.error||"The check could not finish.");
 window.location.assign("/report/"+encodeURIComponent(data.id));return {reportId:data.id,url:"/report/"+data.id,cached:data.cached};
 }catch(e){const message=(e as Error).name==="AbortError"?"Check cancelled or timed out. You can try again.":(e as Error).message;setError(message);throw new Error(message);}
 finally{clearTimeout(timer);pending.current=null;setBusy(false);}
 },[]);
 useEffect(()=>{const context=(document as Document &{modelContext?:ModelContext}).modelContext;if(!context?.registerTool)return;
 const lifecycle=new AbortController();
 Promise.resolve(context.registerTool({name:"check_token_and_open_report",title:"Check a token",description:"Fetch public evidence for an exact token address, save a dated research report and open it. No trades or wallet access.",
 inputSchema:{type:"object",properties:{query:{type:"string",maxLength:2048},chain:{type:"string",enum:NETWORKS}},required:["query","chain"],additionalProperties:false},
 annotations:{readOnlyHint:false,untrustedContentHint:true},
 execute:async(input:unknown)=>{const v=input as {query?:unknown,chain?:unknown};if(!v||typeof v.query!=="string"||v.query.length>2048||!NETWORKS.includes(v.chain as typeof NETWORKS[number]))throw new Error("Use an exact address and supported chain.");return check(v.query,v.chain as string);}
 },{signal:lifecycle.signal})).catch(()=>{});
 return()=>lifecycle.abort();},[check]);
 useEffect(()=>()=>pending.current?.abort(),[]);

 const networkLabel = (network:string) => network === "auto" ? "Auto detect" : network === "bsc" ? "BNB Smart Chain" : network === "robinhood" ? "Robinhood Chain" : network[0].toUpperCase() + network.slice(1);

 return (
  <SiteShell home footerTools={
   <div className="footer-network">
    <span>Network</span>
    <Select value={chain} onValueChange={setChain} disabled={busy}>
     <SelectTrigger aria-label="Blockchain network"><SelectValue>{networkLabel(chain)}</SelectValue></SelectTrigger>
     <SelectContent>{NETWORKS.map(network => <SelectItem value={network} key={network}>{networkLabel(network)}</SelectItem>)}</SelectContent>
    </Select>
   </div>
  }>
   <main className="home-main">
    <section className="search-home" aria-labelledby="home-title">
     <div className="owl-stage">
      <img src="/o-owl.png" alt="O, a friendly purple owl holding a magnifying glass" width="340" height="355" fetchPriority="high"/>
     </div>
     <div className="wordmark home-wordmark" aria-label="OLWIF">olwif<span aria-hidden="true">✦</span></div>
     <h1 id="home-title">O’ look what I found</h1>
     <form className="search-form" aria-busy={busy} onSubmit={event => {
      event.preventDefault();
      void check(query,chain).catch(error => setError(error.message));
     }}>
      <label className="sr-only" htmlFor="token-query">Token address or project token URL</label>
      <div className="search-field">
       <Search aria-hidden="true" size={23}/>
       <Input id="token-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Paste a token address or link" autoComplete="off" maxLength={2048} disabled={busy}/>
       <Button type="submit" className="search-submit" aria-label={busy ? "Checking token" : "Check token"} title="Check token" disabled={busy}>
        {busy ? <LoaderCircle size={21} className="spin" aria-hidden="true"/> : <ArrowUpRight size={23} aria-hidden="true"/>}
       </Button>
      </div>
     </form>
     <SupportedNetworks/>
     {busy && <ResearchOwl onCancel={() => pending.current?.abort()}/>}
     {error && <p role="alert" className="notice error">{error}{/network/i.test(error) && <> You can choose the network at the bottom of this page.</>}</p>}
     {notice && <p role="status" className="notice">{notice}</p>}
    </section>
   </main>
  </SiteShell>
 );
}
