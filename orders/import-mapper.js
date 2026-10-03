import { FIELDS, FIELD_SET } from './order-schema.js';
export const headerKey = value => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const aliases={
 orderId:['order','order id','order no','order number','invoice','invoice no','invoice number','delivery order','do','reference','ref'],
 externalReference:['external ref','customer reference'], customerName:['customer','customer name','client','debtor','debtor name','consignee','receiver','recipient'],
 customerAccount:['customer account','account number','account no','debtor code','customer code'], shipToCode:['ship to code','ship-to code','site code','branch','location code'],
 contactName:['contact name','ship to contact','ship-to contact','contact person','recipient name'],
 address:['address','delivery address','delivery addr','shipping address','ship to','delivery location','destination','alamat'],
 addressLine1:['address line 1','address 1'],addressLine2:['address line 2','address 2'],
 phone:['phone','mobile','mobile no','contact no','contact 1','telephone','tel','hp','contact phone'],email:['email','e mail'],
 postcode:['postcode','postal code','zip','zip code'],city:['city','town'],state:['state','province'],country:['country'],
 quantity:['quantity','qty','pieces','pcs','packages'],weight:['weight','weight kg','kg'],volume:['volume','volume m3'],
 deliveryDate:['delivery date','date','ship date'],serviceTimeMinutes:['service time','service minutes'],priority:['priority'],
 timeWindowStart:['time window start','window start','from time'],timeWindowEnd:['time window end','window end','to time'],
 notes:['notes','remarks','remark','comment'],specialInstructions:['special instructions','delivery instructions','instructions'],latitude:['lat'],longitude:['lng','lon']
};
const exact=new Map(FIELDS.map(([key])=>[headerKey(key),key]));
const known=new Map([...FIELDS.map(([key,label])=>[headerKey(label),key]),...Object.entries(aliases).flatMap(([key,values])=>values.map(value=>[headerKey(value),key]))]);
export function suggestMapping(headers){const used=new Set();return headers.map(header=>{const key=headerKey(header);const field=exact.get(key)||known.get(key)||'';if(!field||used.has(field))return {header,field:'',confidence:'manual'};used.add(field);return {header,field,confidence:exact.get(key)===field?'exact':'alias'};});}
export function validateMapping(mapping){const seen=new Set();for(const field of mapping){if(!field)continue;if(!FIELD_SET.has(field))throw Error(`Unknown field: ${field}`);if(seen.has(field))throw Error(`${field} is mapped more than once.`);seen.add(field);}}
export function mapRow(row,mapping){validateMapping(mapping);return Object.fromEntries(mapping.flatMap((field,i)=>field?[[field,row[i]]]:[]));}
