/**
 * Customer Workspace: Delivery Availability and Service Time on the customer create/edit form.
 *
 * Default mode shows the effective Settings value (resolved live, nothing copied to the customer).
 * Custom mode edits Monday–Sunday individually or a custom service duration. "Return to default" clears
 * the override. Requires delivery-constraints.js and delivery-schedule-editor.js.
 *
 * window.GoRouteXCustomerConstraints = { set(customerOrNull), read() -> { fields, errors }, refresh() }
 */
(function (global) {
  const C = () => global.GoRouteXDeliveryConstraints;
  const Editor = () => global.GoRouteXScheduleEditor;
  const $ = (id) => document.getElementById(id);

  function defaults() {
    return C().globalDefaults(global.GoRouteXSettings?.getCachedSettings?.() || null);
  }

  function mode(name) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value === 'custom' ? 'custom' : 'default';
  }

  function setMode(name, value) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
  }

  function showErrors(messages) {
    const box = $('customerConstraintErrors');
    if (box) box.textContent = messages.join(' ');
  }

  function refresh() {
    if (!$('customerDeliveryAvailability')) return;
    const effective = defaults();
    const scheduleCustom = mode('deliveryScheduleMode') === 'custom';
    $('deliveryScheduleSummary').textContent = scheduleCustom
      ? 'Custom schedule for this customer. Changes to the Settings default do not affect it.'
      : `Settings default: ${C().describeSchedule(effective.schedule)}`;
    $('customDeliverySchedule').hidden = !scheduleCustom;
    $('resetDeliveryScheduleBtn').hidden = !scheduleCustom;

    const serviceCustom = mode('serviceTimeMode') === 'custom';
    $('serviceTimeSummary').textContent = serviceCustom
      ? 'Custom service time for this customer. Changes to the Settings default do not affect it.'
      : `Settings default: ${effective.serviceMinutes ? `${effective.serviceMinutes} minutes` : 'the Default Service Time in Settings'}`;
    $('customServiceMinutesWrap').hidden = !serviceCustom;
    $('resetServiceTimeBtn').hidden = !serviceCustom;
  }

  /** Fill the form from a customer entry (or null for a new customer: both default). */
  function set(entry) {
    if (!$('customerDeliveryAvailability')) return;
    const scheduleCustom = entry?.deliveryScheduleMode === 'custom' && entry.customDeliverySchedule;
    setMode('deliveryScheduleMode', scheduleCustom ? 'custom' : 'default');
    // Custom mode starts from the current default as an editable copy; default mode stores nothing.
    Editor().render($('customDeliverySchedule'), scheduleCustom ? entry.customDeliverySchedule : defaults().schedule, { idPrefix: 'customerSchedule' });
    const serviceCustom = entry?.serviceTimeMode === 'custom' && Number(entry.customServiceMinutes) > 0;
    setMode('serviceTimeMode', serviceCustom ? 'custom' : 'default');
    $('customServiceMinutes').value = serviceCustom ? entry.customServiceMinutes : (defaults().serviceMinutes || '');
    showErrors([]);
    refresh();
  }

  /** Read the overrides to save. errors is non-empty when a custom value is invalid. */
  function read() {
    if (!$('customerDeliveryAvailability')) return { fields: {}, errors: [] };
    const input = { deliveryScheduleMode: mode('deliveryScheduleMode'), serviceTimeMode: mode('serviceTimeMode') };
    if (input.deliveryScheduleMode === 'custom') input.customDeliverySchedule = Editor().read($('customDeliverySchedule'));
    if (input.serviceTimeMode === 'custom') {
      const raw = $('customServiceMinutes').value.trim();
      input.customServiceMinutes = raw === '' ? NaN : Number(raw);
    }
    const errors = C().validateCustomerConstraints(input);
    showErrors(errors);
    return { fields: errors.length ? null : C().customerConstraintFields(input), errors };
  }

  function init() {
    const root = $('customerDeliveryAvailability');
    if (!root || root.dataset.bound === 'true') return;
    root.dataset.bound = 'true';
    document.querySelectorAll('input[name="deliveryScheduleMode"], input[name="serviceTimeMode"]').forEach((radio) => {
      radio.addEventListener('change', () => { showErrors([]); refresh(); });
    });
    $('resetDeliveryScheduleBtn').addEventListener('click', () => {
      setMode('deliveryScheduleMode', 'default');
      Editor().render($('customDeliverySchedule'), defaults().schedule, { idPrefix: 'customerSchedule' });
      showErrors([]);
      refresh();
    });
    $('resetServiceTimeBtn').addEventListener('click', () => {
      setMode('serviceTimeMode', 'default');
      $('customServiceMinutes').value = defaults().serviceMinutes || '';
      showErrors([]);
      refresh();
    });
    // Settings may load after the form renders; the default summary must show the live values.
    global.addEventListener('goroutex:settings-ready', refresh);
    set(null);
  }

  global.GoRouteXCustomerConstraints = { init, set, read, refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
