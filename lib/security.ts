export const NETWORKS = ["auto","solana","ethereum","base","bsc","arbitrum","polygon","optimism","avalanche","blast","robinhood"] as const;
export const PROVIDERS = ["dexscreener","gecko","rugcheck","solana","goplus","blockscout","github","publicweb","websearch"] as const;
export type Provider = typeof PROVIDERS[number];
export const DEFAULT_SETTINGS = {enabled:true,notice:"",disabledSources:[] as string[]};
export type Settings = typeof DEFAULT_SETTINGS;
export function validSolanaAddress(address:string){
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
 const alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let number=0n;
 for(const char of address) number=number*58n+BigInt(alphabet.indexOf(char));
 let bytes=0;for(let n=number;n>0n;n>>=8n)bytes++;
 let zeroes=0;for(const char of address){if(char!=="1")break;zeroes++;}
 return bytes+zeroes===32;
}
export function validateSettings(value:unknown):Settings{
 if(!value||typeof value!=="object")throw new Error("Invalid settings.");
 const v=value as Record<string,unknown>;
 if(typeof v.enabled!=="boolean"||typeof v.notice!=="string"||v.notice.length>350||!Array.isArray(v.disabledSources)||v.disabledSources.some(x=>!PROVIDERS.includes(x as Provider)))throw new Error("Invalid settings.");
 return {enabled:v.enabled,notice:v.notice.trim(),disabledSources:[...new Set(v.disabledSources)] as string[]};
}
export function assertSameOrigin(request:Request,siteOrigin:string){
 const origin=request.headers.get("origin");
 const requestOrigin=new URL(request.url).origin;
 const allowed=new Set([requestOrigin,...(siteOrigin?[siteOrigin]:[])]);
 if(!origin||!allowed.has(origin)||request.headers.get("sec-fetch-site")==="cross-site")throw new Error("Please submit from the OLWIF website.");
 if(!request.headers.get("content-type")?.includes("application/json"))throw new Error("Send a JSON request.");
}
export async function readJson(request:Request,max=4096):Promise<Record<string,unknown>>{
 if(Number(request.headers.get("content-length")||0)>max)throw new Error("Request is too large.");
 const reader=request.body?.getReader();if(!reader)throw new Error("Request is empty.");
 let total=0;const parts:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max)throw new Error("Request is too large.");parts.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 const data=new Uint8Array(total);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
 let value;try{value=JSON.parse(new TextDecoder().decode(data));}catch{throw new Error("Invalid JSON.");}
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid request.");
 return value;
}
export function safeLink(raw:unknown){if(typeof raw!=="string"||raw.length>2048)return null;try{const u=new URL(raw);if(!["https:","http:"].includes(u.protocol)||u.username||u.password)return null;return u.href;}catch{return null;}}
export function providerForHost(host:string):Provider|null{
 if(host==="api.dexscreener.com")return "dexscreener";if(host==="api.geckoterminal.com")return "gecko";
 if(host==="api.rugcheck.xyz")return "rugcheck";if(["solana-rpc.publicnode.com","rpc.solanatracker.io","api.mainnet-beta.solana.com"].includes(host))return "solana";
 if(host==="api.gopluslabs.io")return "goplus";if(["eth.blockscout.com","base.blockscout.com","arbitrum.blockscout.com","optimism.blockscout.com","robinhoodchain.blockscout.com"].includes(host))return "blockscout";
 if(host==="api.github.com")return "github";return null;
}
