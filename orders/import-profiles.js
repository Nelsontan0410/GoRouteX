import { headerKey,validateMapping } from './import-mapper.js';
export function makeProfile(name,headers,mapping,id=crypto.randomUUID()){validateMapping(mapping);return {id,name:name.trim(),headers:headers.map(headerKey).sort(),fields:Object.fromEntries(headers.map((h,i)=>[headerKey(h),mapping[i]||''])),updatedAt:new Date().toISOString()};}
export function matchProfile(profiles,headers){const signature=headers.map(headerKey).sort().join('|');return profiles.find(profile=>profile.headers.join('|')===signature)||null;}
export function applyProfile(profile,headers){return headers.map(header=>profile.fields[headerKey(header)]||'');}
