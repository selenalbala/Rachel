import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({plugins:[react(),VitePWA({registerType:'autoUpdate',includeAssets:['icon.svg'],manifest:{name:'Bella · Peluquería y Estética',short_name:'Bella',theme_color:'#ff2f92',background_color:'#fff7fb',display:'standalone',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]},workbox:{navigateFallback:'/index.html',runtimeCaching:[{urlPattern:({url})=>url.pathname.startsWith('/api/'),handler:'NetworkFirst',options:{cacheName:'bella-api',networkTimeoutSeconds:4,expiration:{maxEntries:100,maxAgeSeconds:86400}}}]}})]});
