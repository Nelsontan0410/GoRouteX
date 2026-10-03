export const FIELDS = [
 ['orderId','Order ID'],['externalReference','External reference'],['customerName','Customer'],['customerAccount','Customer account'],['shipToCode','Ship-to code'],['contactName','Contact name'],['phone','Phone'],['email','Email'],['address','Delivery address'],['addressLine1','Address line 1'],['addressLine2','Address line 2'],['postcode','Postcode'],['city','City'],['state','State'],['country','Country'],['latitude','Latitude'],['longitude','Longitude'],['quantity','Quantity'],['weight','Weight'],['volume','Volume'],['deliveryDate','Delivery date'],['serviceTimeMinutes','Service time'],['priority','Priority'],['timeWindowStart','Window start'],['timeWindowEnd','Window end'],['notes','Notes'],['specialInstructions','Special instructions']
];
export const STATUS = ['READY','NEEDS_REVIEW','DUPLICATE'];
export const FIELD_SET = new Set(FIELDS.map(([key])=>key));
