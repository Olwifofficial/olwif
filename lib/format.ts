export function tokenSupply(raw:unknown,decimals:unknown){
 if(!/^\d+$/.test(String(raw))||typeof decimals!=="number"||!Number.isInteger(decimals)||decimals<0||decimals>255)return "Not verified";
 const digits=String(raw).replace(/^0+(?=\d)/,"").padStart(decimals+1,"0");
 const whole=decimals?digits.slice(0,-decimals):digits;
 const fraction=decimals?digits.slice(-decimals).replace(/0+$/,""):"";
 return BigInt(whole).toLocaleString("en-GB")+(fraction?"."+fraction:"");
}
export function taxPercent(raw:unknown){return typeof raw==="number"&&Number.isFinite(raw)?raw*100:null;}
