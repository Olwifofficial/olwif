import {providerForHost,Settings} from "./security";
export function sourceFetch(settings:Settings,githubToken="",upstream:typeof fetch=fetch):typeof fetch{
 return (async(input:RequestInfo|URL,init:RequestInit={})=>{
 const url=new URL(String(input));const provider=providerForHost(url.hostname);
 if(url.protocol!=="https:"||url.username||url.password||url.port||!provider)throw new Error("Unapproved data source.");
 if(settings.disabledSources.includes(provider))throw new Error("This source is paused by the site owner.");
 const headers=new Headers(init.headers);headers.set("User-Agent","OLWIF-Research/1.0");
 if(url.hostname==="api.github.com"&&githubToken)headers.set("Authorization","Bearer "+githubToken);
 let response:Response;
 try{response=await upstream(url.href,{...init,headers,redirect:"manual",credentials:"omit"});}
 catch(e){console.warn("Public source request failed",provider,(e as Error).name);throw e;}
 if(response.status>=300&&response.status<400)throw new Error("Source redirect not followed.");
 if(!response.ok)return response;
 if(Number(response.headers.get("content-length")||0)>2000000)throw new Error("Source response was too large.");
 const reader=response.body?.getReader();if(!reader)throw new Error("Source response was empty.");
 let length=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2000000)throw new Error("Source response was too large.");chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 const data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 return new Response(data,{status:response.status,headers:{"Content-Type":"application/json"}});
 }) as typeof fetch;
}
