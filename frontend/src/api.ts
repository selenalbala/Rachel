const API_URL=(import.meta.env.VITE_API_URL||"http://localhost:8080").replace(/\/+$/,"");
const TOKEN_KEY="rachel_studio_token";
const CLIENT_TOKEN_KEY="rachel_studio_client_token";
export const getToken=()=>localStorage.getItem(TOKEN_KEY);
export const setToken=(token:string|null)=>token?localStorage.setItem(TOKEN_KEY,token):localStorage.removeItem(TOKEN_KEY);
export const getClientToken=()=>localStorage.getItem(CLIENT_TOKEN_KEY);
export const setClientToken=(token:string|null)=>token?localStorage.setItem(CLIENT_TOKEN_KEY,token):localStorage.removeItem(CLIENT_TOKEN_KEY);
function buildUrl(path:string){const p=path.startsWith("/")?path:`/${path}`;if(p.startsWith("/auth/")||p.startsWith("/client-auth/")||p.startsWith("/public/")||p==="/health")return `${API_URL}${p}`;return `${API_URL}/api${p}`;}
async function request<T>(path:string,options:RequestInit={},token?:string|null){const headers=new Headers(options.headers);if(options.body&&!headers.has("Content-Type"))headers.set("Content-Type","application/json");if(token)headers.set("Authorization",`Bearer ${token}`);const r=await fetch(buildUrl(path),{...options,headers});const data=(r.headers.get("content-type")||"").includes("application/json")?await r.json():null;if(!r.ok){const e:any=new Error(data?.message||`Error ${r.status}`);e.fields=data?.fields||{};throw e;}return data as T;}
export const api=<T=any>(path:string,options:RequestInit={})=>request<T>(path,options,getToken());
export const clientApi=<T=any>(path:string,options:RequestInit={})=>request<T>(path,options,getClientToken());
