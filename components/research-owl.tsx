import {useId,useState} from "react";

/** A small, CSS-only companion while an actual research request is pending. */
export default function ResearchOwl({onCancel}:{onCancel:()=>void}) {
 const id=useId().replace(/:/g,"");
 const [playMotion,setPlayMotion]=useState(false);
 return (
  <div className="research-loading" data-testid="research-loading" data-motion={playMotion ? "on" : "auto"}>
   <div className="research-owl-track" aria-hidden="true">
    <div className="research-owl-runner">
     <svg className="research-owl-scene" viewBox="0 0 190 140" width="190" height="140" focusable="false">
      <defs>
       <linearGradient id={`${id}-feathers`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#b697dc"/><stop offset="1" stopColor="#7952ac"/>
       </linearGradient>
       <linearGradient id={`${id}-belly`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#efe3fa"/><stop offset="1" stopColor="#d6c0eb"/>
       </linearGradient>
      </defs>
      <ellipse className="research-owl-shadow" cx="90" cy="127" rx="40" ry="5" fill="#77548f" opacity=".12"/>
      <g className="research-owl-speed" fill="none" stroke="#c5addd" strokeWidth="2.5" strokeLinecap="round">
       <path d="M27 92h-12M23 101H5M29 110H17"/>
      </g>
      <g className="research-owl-leg research-owl-leg-back" fill="none" stroke="#d99956" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
       <path d="M101 112l8 10 13-2m-13 2 7 5"/>
      </g>
      <g className="research-owl-leg research-owl-leg-front" fill="none" stroke="#efb46a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
       <path d="M76 112l-7 10H55m14 0-7 5"/>
      </g>
      <g className="research-owl-bob">
       <path d="M50 77Q30 86 41 107L57 99" fill="#8b61b4"/>
       <path d="M50 56Q37 32 49 18L64 29Q88 15 113 30l15-13q9 21 0 41 13 15 9 37-5 25-45 25-44 0-48-25-3-21 6-39Z" fill={`url(#${id}-feathers)`}/>
       <ellipse cx="89" cy="94" rx="29" ry="24" fill={`url(#${id}-belly)`}/>
       <path d="m75 95 4 4 4-4m7 10 4 4 4-4m-9-19 4 4 4-4" fill="none" stroke="#b797d0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
       <path d="M88 47C76 22 44 34 49 61c3 15 22 24 40 17 17 7 37-2 40-17 5-27-27-39-41-14Z" fill="#fff4e8"/>
       <g className="research-owl-eyes">
        <ellipse cx="70" cy="56" rx="11" ry="14" fill="#483059"/>
        <ellipse cx="109" cy="56" rx="11" ry="14" fill="#483059"/>
        <ellipse cx="73" cy="59" rx="6" ry="8" fill="#745094"/>
        <ellipse cx="112" cy="59" rx="6" ry="8" fill="#745094"/>
        <circle cx="73" cy="51" r="4" fill="white"/>
        <circle cx="112" cy="51" r="4" fill="white"/>
       </g>
       <path d="M83 65q7-5 14 0l-7 10Z" fill="#edb16d" stroke="#da9756" strokeLinejoin="round"/>
       <ellipse cx="58" cy="71" rx="6" ry="3" fill="#e9bcca" opacity=".65"/>
       <ellipse cx="120" cy="71" rx="6" ry="3" fill="#e9bcca" opacity=".65"/>
       <g className="research-owl-folder">
        <path d="m110 88 6-24 15 3 4 6 26 6-8 34-47-12Z" fill="#c2a1df" stroke="#9975b9" strokeWidth="1.5"/>
        <g className="research-owl-paper research-owl-paper-back">
         <path d="m120 68 32 5-5 32-33-5Z" fill="#fffcff" stroke="#c4afd7" strokeWidth="1.5"/>
         <path d="m126 77 18 3m-19 3 16 3m-17 3 11 2" stroke="#c9b5db" strokeWidth="2" strokeLinecap="round"/>
        </g>
        <g className="research-owl-paper research-owl-paper-front">
         <path d="m118 68 32 5-5 32-33-5Z" fill="white" stroke="#c4afd7" strokeWidth="1.5"/>
         <path d="m124 77 18 3m-19 3 16 3m-17 3 11 2" stroke="#b8a1cb" strokeWidth="2" strokeLinecap="round"/>
        </g>
        <path d="m108 90 45 10-3 16-43-11Z" fill="#dec9ee" stroke="#ad8ec5" strokeWidth="1.5" strokeLinejoin="round"/>
       </g>
       <g className="research-owl-wing">
        <path d="M108 80q-12 3-5 17 4 8 22 2l12-8q-3-7-11-3l-7 3q2-12-11-11Z" fill="#9f79c5" stroke="#8c63b6" strokeWidth="1.5"/>
        <path d="m117 93 9-3m-7 7 9-3" fill="none" stroke="#bb98d9" strokeWidth="1.5" strokeLinecap="round"/>
       </g>
      </g>
     </svg>
    </div>
    <span className="research-owl-ground"/>
   </div>
   <div className="research-loading-caption">
    <p role="status" aria-live="polite">O’s on the case…</p>
    <button type="button" className="research-loading-cancel" onClick={onCancel} aria-label="Cancel token check">Cancel</button>
    <button type="button" className="research-motion-toggle" aria-pressed={playMotion} onClick={() => setPlayMotion(value => !value)}>{playMotion ? "Pause animation" : "Animate O"}</button>
   </div>
  </div>
 );
}
