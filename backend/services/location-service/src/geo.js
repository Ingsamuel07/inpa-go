const EARTH_RADIUS_METERS=6371000;
const radians=(degrees)=>degrees*Math.PI/180;
export function distanceMeters(a,b){const dLat=radians(b.latitude-a.latitude),dLon=radians(b.longitude-a.longitude);const lat1=radians(a.latitude),lat2=radians(b.latitude);const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return Math.round(2*EARTH_RADIUS_METERS*Math.asin(Math.sqrt(h)));}