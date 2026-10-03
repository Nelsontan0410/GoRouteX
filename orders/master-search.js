(function (global) {
  const lower = value => String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
  const digits = value => String(value || '').replace(/\D/g, '');
  function search(master, type, query) {
    const term = lower(query), phone = digits(query);
    if (!term || !['customer','contact','phone','address'].includes(type)) return [];
    if (type === 'phone' && !phone) return [];
    const customers = new Map((master.customers || []).map(customer => [customer.id, customer]));
    const stops = (master.stops || []).filter(stop => stop?.id);
    const stopById = new Map(stops.map(stop => [stop.id, stop]));
    const customerName = (id, fallback) => customers.get(id)?.name || fallback || 'Unassigned customer';
    const matches = value => lower(value).includes(term);
    const matchesPhone = value => digits(value).includes(phone);
    const results = [];
    for (const stop of stops) {
      const customer = customerName(stop.customerId, stop.customerName || stop.name);
      const hit = type === 'customer' ? matches(customer)
        : type === 'contact' ? matches(stop.contactName || stop.name)
        : type === 'phone' ? matchesPhone(stop.phone || stop['Hp No'])
        : matches(stop.address || stop.Address);
      if (hit) results.push({kind:'stop', id:stop.id, customer, stop:stop.label || stop.name || '',
        address:stop.address || stop.Address || '', phone:stop.phone || stop['Hp No'] || '', contact:''});
    }
    for (const contact of master.contacts || []) {
      if (!contact?.id) continue;
      const stop = stopById.get(contact.savedStopId), customer = customerName(contact.customerId, stop?.customerName || stop?.name);
      const hit = type === 'customer' ? matches(customer)
        : type === 'contact' ? matches(contact.name)
        : type === 'phone' ? matchesPhone(contact.phone)
        : Boolean(stop && matches(stop.address || stop.Address));
      if (hit) results.push({kind:'contact', id:contact.id, customer, stop:stop?.label || stop?.name || (contact.savedStopId ? 'Missing linked stop' : 'General customer contact'),
        address:stop?.address || stop?.Address || '', phone:contact.phone || '', contact:contact.name || ''});
    }
    return results;
  }
  global.GoRouteXMasterSearch = {search};
})(window);
