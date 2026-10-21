export function navigationUrl(stop){const lat=Number(stop?.lat),lng=Number(stop?.lng);if(stop?.lat!=null&&stop?.lng!=null&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;const address=String(stop?.deliveryAddress||'').trim();return address?`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`:null;}
export function callUrl(stop){const phone=String(stop?.contactPhone||'').trim().replace(/[\s().-]/g,'');return /^\+?[0-9]{5,18}$/.test(phone)?`tel:${phone}`:null;}

// Whole-day navigation in Google Maps (decided 2026-10-11). One Maps link holds the start, up to 8 waypoints
// and a destination, so a link covers 9 stops; the next link starts at the stop where the previous one ended.
// Example, 16 stops: part 1 = start + stops 1-9, part 2 = stop 9 + stops 10-16 + end.
export const MAPS_LINK_WAYPOINTS=8;
function mapsPlace(point){if(!point)return null;const lat=Number(point.lat),lng=Number(point.lng);if(point.lat!=null&&point.lng!=null&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)return `${lat},${lng}`;const address=String(point.deliveryAddress||point.address||point.label||'').trim();return address||null;}
/**
 * origin/end: {lat,lng}|{address}|null (no origin: Google Maps starts from the phone's location).
 * stops: delivery stops in driving order ({lat,lng,deliveryAddress,stopName,sequence}).
 * detours: [{lat,lng,legIndex}] where leg i ends at stops[i] (i === stops.length: the end).
 * Returns [{ url, fromLabel, toLabel, firstStop, lastStop }].
 */
export function navigationParts({origin=null,originLabel='Start',end=null,endLabel='End',stops=[],detours=[],maxWaypoints=MAPS_LINK_WAYPOINTS}={}){
 const items=[];const viaFor=leg=>detours.filter(point=>point?.legIndex===leg).map(point=>({place:mapsPlace(point),detour:true}));
 stops.forEach((stop,index)=>{items.push(...viaFor(index));items.push({place:mapsPlace(stop),label:String(stop.stopName||stop.customerName||`Stop ${stop.sequence||index+1}`),sequence:stop.sequence||index+1});});
 const endPlace=mapsPlace(end);if(endPlace){items.push(...viaFor(stops.length));items.push({place:endPlace,label:endLabel,end:true});}
 const usable=items.filter(item=>item.place);const parts=[];let from=mapsPlace(origin),fromLabel=from?originLabel:'Your location';
 for(let index=0;index<usable.length;){const chunk=usable.slice(index,index+maxWaypoints+1);const destination=chunk[chunk.length-1],via=chunk.slice(0,-1);const delivery=chunk.filter(item=>item.sequence);
  const url=`https://www.google.com/maps/dir/?api=1${from?`&origin=${encodeURIComponent(from)}`:''}&destination=${encodeURIComponent(destination.place)}${via.length?`&waypoints=${via.map(item=>encodeURIComponent(item.place)).join('%7C')}`:''}&travelmode=driving`;
  parts.push({url,fromLabel,toLabel:destination.end?endLabel:`Stop ${destination.sequence}`,firstStop:delivery[0]?.sequence??null,lastStop:delivery[delivery.length-1]?.sequence??null});
  from=destination.place;fromLabel=destination.end?endLabel:`Stop ${destination.sequence}`;index+=chunk.length;}
 return parts;
}

// Use only an explicitly international saved number; never guess its country. Opening a chat sends no message.
export function whatsappUrl(stop) {
 const phone=String(stop?.contactPhone||'').trim().replace(/[\s().-]/g,'');
 return /^\+[1-9][0-9]{7,14}$/.test(phone)?`https://wa.me/${phone.slice(1)}`:null;
}
