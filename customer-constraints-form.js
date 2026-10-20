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

  let advanced = false;
  const HOURS = { full: ['09:00', '18:00'], am: ['09:00', '13:00'], pm: ['13:00', '18:00'] };

  function simpleSchedule(weekdays, weekend, hours) {
    const [start, end] = HOURS[hours] || HOURS.full;
    return Object.fromEntries(C().DAY_KEYS.map((day, index) => [day, {
      open: index < 5 ? weekdays : weekend,
      windows: (index < 5 ? weekdays : weekend) ? [{ start, end }] : [], breaks: []
    }]));
  }

  function detectSimple(schedule) {
    for (const weekdays of [true, false]) for (const weekend of [false, true]) {
      if (!weekdays && !weekend) continue;
      for (const hours of Object.keys(HOURS)) {
        if (JSON.stringify(C().cloneSchedule(schedule)) === JSON.stringify(simpleSchedule(weekdays, weekend, hours))) return { weekdays, weekend, hours };
      }
    }
    return null;
  }

  function fillSimple(preset) {
    $('deliveryWeekdays').checked = preset.weekdays;
    $('deliveryWeekend').checked = preset.weekend;
    setMode('deliveryHours', preset.hours);
  }

  function readSimple() {
    return simpleSchedule($('deliveryWeekdays').checked, $('deliveryWeekend').checked,
      document.querySelector('input[name="deliveryHours"]:checked')?.value);
  }

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
      ? (advanced ? 'Custom schedule. Receiving hours and breaks are shown below.' : 'Simple preset: the selected hours are continuous, with no break. Settings defaults are unchanged.')
      : `Settings default: ${C().describeSchedule(effective.schedule)}`;
    $('customDeliverySchedule').hidden = !scheduleCustom || !advanced;
    $('simpleDeliveryTiming').hidden = advanced;
    $('toggleAdvancedTimingBtn').textContent = advanced ? 'Use Simple Timing' : 'Advanced Timing';
    $('toggleAdvancedTimingBtn').setAttribute('aria-expanded', String(advanced));
    $('resetDeliveryScheduleBtn').hidden = !scheduleCustom;

    const serviceCustom = mode('serviceTimeMode') === 'custom';
    $('serviceTimeSummary').textContent = serviceCustom
      ? 'Custom service time for this customer. Changes to the Settings default do not affect it.'
      : `Settings default: ${effective.serviceMinutes ? `${effective.serviceMinutes} minutes` : 'the Default Service Time in Settings'}`;
    $('customServiceMinutesWrap').hidden = !serviceCustom;
    $('resetServiceTimeBtn').hidden = !serviceCustom;
  }

  /** Fill the form from a customer entry (or null for a new customer: simple weekdays, default service). */
  function set(entry) {
    if (!$('customerDeliveryAvailability')) return;
    const scheduleCustom = entry?.deliveryScheduleMode === 'custom' && entry.customDeliverySchedule;
    setMode('deliveryScheduleMode', !entry || scheduleCustom ? 'custom' : 'default');
    const preset = scheduleCustom ? detectSimple(entry.customDeliverySchedule) : null;
    advanced = !!scheduleCustom && !preset;
    fillSimple(preset || { weekdays: true, weekend: false, hours: 'full' });
    // Custom mode starts from the current default as an editable copy; default mode stores nothing.
    Editor().render($('customDeliverySchedule'), scheduleCustom ? entry.customDeliverySchedule : defaults().schedule, { idPrefix: 'customerSchedule' });
    const serviceCustom = entry?.serviceTimeMode === 'custom' && Number(entry.customServiceMinutes) > 0;
    setMode('serviceTimeMode', serviceCustom ? 'custom' : 'default');
    $('customServiceMinutes').value = serviceCustom ? entry.customServiceMinutes : (defaults().serviceMinutes || '');
    $('customerAdvancedDetails').open = !!serviceCustom;
    showErrors([]);
    refresh();
  }

  /** Read the overrides to save. errors is non-empty when a custom value is invalid. */
  function read() {
    if (!$('customerDeliveryAvailability')) return { fields: {}, errors: [] };
    const input = { deliveryScheduleMode: mode('deliveryScheduleMode'), serviceTimeMode: mode('serviceTimeMode') };
    if (input.deliveryScheduleMode === 'custom') input.customDeliverySchedule = advanced ? Editor().read($('customDeliverySchedule')) : readSimple();
    if (input.serviceTimeMode === 'custom') {
      const raw = $('customServiceMinutes').value.trim();
      input.customServiceMinutes = raw === '' ? NaN : Number(raw);
    }
    const errors = C().validateCustomerConstraints(input);
    if (input.deliveryScheduleMode === 'custom' && !advanced && !$('deliveryWeekdays').checked && !$('deliveryWeekend').checked) errors.push('Select Weekdays or Weekend before saving.');
    showErrors(errors);
    return { fields: errors.length ? null : C().customerConstraintFields(input), errors };
  }

  function init() {
    const root = $('customerDeliveryAvailability');
    if (!root || root.dataset.bound === 'true') return;
    root.dataset.bound = 'true';
    document.querySelectorAll('input[name="deliveryScheduleMode"], input[name="serviceTimeMode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.name === 'deliveryScheduleMode' && radio.value === 'custom' && !advanced) {
          Editor().render($('customDeliverySchedule'), defaults().schedule, { idPrefix: 'customerSchedule' });
          advanced = true;
        }
        showErrors([]); refresh();
      });
    });
    document.querySelectorAll('#simpleDeliveryTiming input').forEach((input) => input.addEventListener('change', () => {
      setMode('deliveryScheduleMode', 'custom');
      showErrors([]); refresh();
    }));
    $('toggleAdvancedTimingBtn').addEventListener('click', () => {
      if (advanced) {
        const preset = detectSimple(Editor().read($('customDeliverySchedule')));
        if (!preset && !global.confirm('Replace this custom schedule and its breaks with the selected simple timing preset?')) return;
        if (preset) fillSimple(preset);
      } else {
        Editor().render($('customDeliverySchedule'), mode('deliveryScheduleMode') === 'default' ? defaults().schedule : readSimple(), { idPrefix: 'customerSchedule' });
      }
      advanced = !advanced;
      setMode('deliveryScheduleMode', 'custom');
      showErrors([]); refresh();
    });
    $('resetDeliveryScheduleBtn').addEventListener('click', () => {
      setMode('deliveryScheduleMode', 'default');
      advanced = false;
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

  global.GoRouteXCustomerConstraints = { init, set, read, refresh, simpleSchedule, detectSimple };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
