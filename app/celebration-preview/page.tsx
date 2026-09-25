"use client";
import {useState} from "react";
import SiteShell from "@/app/site-shell";
import ReportCelebration from "@/components/report-celebration";
export default function CelebrationPreview(){const [play,setPlay]=useState(0);return <SiteShell><main className="page-wrap prose-page"><p className="eyebrow">DESIGN PREVIEW</p><h1 className="page-title">A little celebration from O.</h1><p>This page previews the animation only. It does not rate a token or change any report. On real reports, all five categories and the overall verdict must meet the same green-check rules, with a check no more than 15 minutes old.</p><button className="account-button" onClick={()=>setPlay(value=>value+1)}>Play O’s confetti</button><p className="small">Reduced-motion settings show O without animated confetti.</p><a className="inline-link" href="/">Back to search</a>{play>0&&<ReportCelebration key={play} preview/>}</main></SiteShell>;}
