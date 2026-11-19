import {useEffect,useRef,useState} from 'react'

type Point={latitude:number;longitude:number}
type LeafletMarker={setLatLng:(point:[number,number])=>LeafletMarker;bindPopup:(text:string)=>LeafletMarker;addTo:(map:LeafletMap)=>LeafletMarker;remove:()=>void}
type LeafletPolyline={setLatLngs:(path:[number,number][])=>LeafletPolyline;addTo:(map:LeafletMap)=>LeafletPolyline;remove:()=>void}
type LeafletMap={setView:(center:[number,number],zoom:number)=>LeafletMap;fitBounds:(bounds:[number,number][],options?:{padding?:[number,number];maxZoom?:number})=>LeafletMap;remove:()=>void}
type LeafletLibrary={
 map:(element:HTMLElement,options?:Record<string,unknown>)=>LeafletMap
 tileLayer:(url:string,options:Record<string,unknown>)=>{addTo:(map:LeafletMap)=>void}
 marker:(point:[number,number],options?:Record<string,unknown>)=>LeafletMarker
 divIcon:(options:Record<string,unknown>)=>unknown
 polyline:(path:[number,number][],options:Record<string,unknown>)=>LeafletPolyline
}
declare global {interface Window {L?:LeafletLibrary;flashfoodLeafletPromise?:Promise<LeafletLibrary>}}
function valid(point:Point|undefined|null):point is Point{
 return !!point&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=90&&Math.abs(point.longitude)<=180
}
function loadLeaflet():Promise<LeafletLibrary>{
 if(window.L)return Promise.resolve(window.L)
 if(window.flashfoodLeafletPromise)return window.flashfoodLeafletPromise
 window.flashfoodLeafletPromise=new Promise<LeafletLibrary>((resolve,reject)=>{
  if(!document.querySelector('link[data-flashfood-leaflet]')){
   const css=document.createElement('link')
   css.rel='stylesheet';css.dataset.flashfoodLeaflet='1'
   css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
   document.head.appendChild(css)
  }
  const script=document.createElement('script')
  script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  script.async=true
  script.onload=()=>window.L?resolve(window.L):reject(new Error('Mapa no disponible'))
  script.onerror=()=>reject(new Error('No se pudo descargar el mapa'))
  document.head.appendChild(script)
 }).catch(e=>{window.flashfoodLeafletPromise=undefined;throw e})
 return window.flashfoodLeafletPromise
}
const asPair=(point:Point):[number,number]=>[point.latitude,point.longitude]
export default function LiveDeliveryMap({driver,destination,route}:{
 driver:Point;destination?:Point|null;route?:[number,number][]
}){
 const host=useRef<HTMLDivElement|null>(null)
 const mapRef=useRef<LeafletMap|null>(null)
 const markers=useRef<{driver?:LeafletMarker;destination?:LeafletMarker}>({})
 const polylineRef=useRef<LeafletPolyline|null>(null)
 const [error,setError]=useState('')
 useEffect(()=>{
  let live=true
  void loadLeaflet().then(L=>{
   if(!live||!host.current||mapRef.current)return
   const map=L.map(host.current,{zoomControl:true,scrollWheelZoom:false})
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© OpenStreetMap contributors',maxZoom:19
   }).addTo(map)
   mapRef.current=map
   if(route&&route.length>1){
    polylineRef.current=L.polyline(route,{color:'#f97316',weight:5,opacity:0.85}).addTo(map)
   }
   const riderIcon=L.divIcon({html:'<span style="display:flex;align-items:center;justify-content:center;background:#ea580c;color:white;border:3px solid white;border-radius:50%;width:35px;height:35px;box-shadow:0 2px 8px #0005;font-size:20px">🛵</span>',className:'',iconSize:[38,38],iconAnchor:[19,19]})
   const homeIcon=L.divIcon({html:'<span style="display:flex;align-items:center;justify-content:center;background:#16a34a;color:white;border:3px solid white;border-radius:50%;width:35px;height:35px;box-shadow:0 2px 8px #0005;font-size:20px">📍</span>',className:'',iconSize:[38,38],iconAnchor:[19,19]})
   markers.current.driver=L.marker(asPair(driver),{icon:riderIcon}).bindPopup('Ubicación del repartidor').addTo(map)
   if(valid(destination))markers.current.destination=L.marker(asPair(destination),{icon:homeIcon}).bindPopup('Dirección de entrega').addTo(map)
   if(valid(destination))map.fitBounds([asPair(driver),asPair(destination)],{padding:[35,35],maxZoom:16})
   else map.setView(asPair(driver),15)
  }).catch(e=>{if(live)setError(e instanceof Error?e.message:'No se pudo cargar el mapa')})
  return ()=>{live=false;polylineRef.current=null;mapRef.current?.remove();mapRef.current=null;markers.current={}}
  // Initialize once for each rendered map; subsequent positions update markers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[])
 useEffect(()=>{
  if(!mapRef.current)return
  markers.current.driver?.setLatLng(asPair(driver))
  if(route&&route.length>1)polylineRef.current?.setLatLngs(route)
  if(valid(destination))markers.current.destination?.setLatLng(asPair(destination))
 },[driver.latitude,driver.longitude,destination?.latitude,destination?.longitude,route])
 return <div className="space-y-2">
  {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
  <div ref={host} role="region" aria-label="Mapa en vivo de repartidor y destino" className="h-72 w-full overflow-hidden rounded-xl border bg-slate-100"/>
  <p className="text-xs text-slate-500">🛵 Repartidor · 📍 Tu dirección. Se actualiza conforme llegan posiciones GPS. Cartografía © OpenStreetMap.</p>
 </div>
}
