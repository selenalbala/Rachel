export const API=(import.meta.env.VITE_API_URL||'http://localhost:3001').replace(/\/$/,'');
export async function getDashboard(){ const r=await fetch(`${API}/api/dashboard`); if(!r.ok) throw new Error('No se pudo cargar'); return r.json(); }
