// Local-only visual test harness. Run: node tests/driver-companion-preview.mjs
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const boot=`import {DriverRouteStore} from '/driver/route-store.js';
import {fixtureRoute,fixtureStore} from '/tests/fixtures/driver-companion.mjs';
import {startExecution} from '/driver/execution.js';
const scenario=new URLSearchParams(location.search).get('scenario');
const route=fixtureRoute();if(scenario==='empty')route.date='2000-01-01';
const store=fixtureStore(route,scenario==='active'?startExecution(route,'drv_test'):null);
DriverRouteStore.create=async()=>store;
window.firebase={firestore:()=>({collection:()=>({doc:()=>({collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({contactRequired:true})})})})})})})};
window.FirebaseApp={auth:{onAuthStateChange:fn=>fn({uid:'drv_test'}),getProfile:async()=>({success:true,profile:{role:'driver',active:true}}),isDriverAccount:()=>true}};
let status='ready';window.DriverTrackingPage={isReady:()=>true,setRouteContext(){},getStatus:()=>status,getProblem:()=>scenario==='denied'?{denied:true,message:'Test permission denied'}:null,startTracking:async()=>{status='active';return true;},stopTracking:async()=>{status='stopped';return true;},refreshNow(){}};
document.getElementById('trackingLoadingScreen').hidden=true;document.getElementById('trackingWorkspace').hidden=false;
document.getElementById('driverStatusChip').textContent='Test GPS';
await import('/driver/driver-page.js');`;
http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/_test/boot.js'){res.setHeader('Content-Type','text/javascript');res.end(boot);return;}
  let filename=url.pathname==='/driver.html'?'/driver-tracking.html':url.pathname;
  const full=path.resolve(root,'.'+filename);if(!full.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  let data=await readFile(full);
  if(url.pathname==='/driver.html'&&url.searchParams.has('fixture')){
   data=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]*https:\/\/fonts[^>]*>/g,'');
   data=data.replace('<body>','<body><div style="padding:8px 16px;background:#fff2d6;color:#654600;font:12px system-ui;text-align:center">LOCAL TEST FIXTURE · No live account or delivery data</div>');
   data=data.replace('</body>','<script type="module" src="/_test/boot.js"></script></body>');
  }
  const ext=path.extname(full),types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png'};
  res.setHeader('Content-Type',types[ext]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(8765,'127.0.0.1',()=>console.log('Local Driver verification: http://127.0.0.1:8765/driver.html?fixture'));
