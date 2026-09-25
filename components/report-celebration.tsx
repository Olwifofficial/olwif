"use client";
import {useEffect,useState} from "react";
import {celebrationEligible} from "@/lib/research/celebration.js";
type Props={report?:Record<string,unknown>;id?:string;preview?:boolean};
export default function ReportCelebration({report,id,preview=false}:Props){
 const [activeId,setActiveId]=useState<string|null>(null);
 const key=preview?"preview":id||"",eligible=preview||celebrationEligible(report);
 useEffect(()=>{
  if(!key||!eligible)return;
  let hide:ReturnType<typeof setTimeout>|undefined;
  const show=setTimeout(()=>{
   if(!preview){try{const storageKey="olwif-celebrated:"+key;if(sessionStorage.getItem(storageKey))return;sessionStorage.setItem(storageKey,"1");}catch{return;}}
   setActiveId(key);hide=setTimeout(()=>setActiveId(null),5000);
  },0);
  return()=>{clearTimeout(show);if(hide)clearTimeout(hide);};
 },[key,eligible,preview]);
 if(activeId!==key||!eligible)return null;
 return <aside className="owl-celebration" aria-label={preview?"Animation preview":"Six green checks"}>
  <button className="celebration-close" aria-label="Dismiss celebration" onClick={()=>setActiveId(null)}>×</button>
  <div className="confetti-burst" aria-hidden="true">{Array.from({length:32},(_,i)=><i key={i} style={{"--piece":i,"--drift":`${(i%2?-1:1)*(45+(i*47)%250)}px`,"--rise":`${-130-(i*31)%210}px`,"--turn":`${180+i*37}deg`,"--delay":`${(i%6)*.045}s`,"--confetti":['#7546bd','#c49ced','#2da475','#f4c52d','#f487a3'][i%5]} as React.CSSProperties}/>)}</div>
  <div className="celebration-owl"><img src="/o-owl-checked.png" alt="O the owl celebrating with a checked sign" width={210} height={210}/><span className="confetti-cannon" aria-hidden="true">✦</span></div>
  <div role="status"><strong>{preview?"O’s celebration preview":"Six green checks in this snapshot"}</strong><p>{preview?"Animation only — this is not a token assessment.":"Listed checks clear—not a guarantee of safety or profit."}</p></div>
 </aside>;
}
