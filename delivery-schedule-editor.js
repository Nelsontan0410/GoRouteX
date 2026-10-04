/**
 * Seven-day delivery schedule editor shared by Settings (global default) and the Customer Workspace
 * (custom override). Each day: Open, receiving hours, and an optional break. Reads and writes the schedule
 * shape used by delivery-constraints.js. Requires delivery-constraints.js.
 *
 * GoRouteXScheduleEditor.render(container, schedule, { idPrefix, onChange })
 * GoRouteXScheduleEditor.read(container) -> schedule
 */
(function (global) {
  const C = () => global.GoRouteXDeliveryConstraints;

  function row(day, entry, prefix) {
    const window = entry.windows?.[0] || {};
    const block = entry.breaks?.[0] || {};
    const id = (field) => `${prefix}-${day}-${field}`;
    const disabled = entry.open ? '' : ' disabled';
    return `<fieldset class="schedule-day" data-day="${day}">
      <legend class="schedule-day-name">${C().DAY_LABELS[day]}</legend>
      <label class="schedule-open"><input type="checkbox" id="${id('open')}" data-field="open"${entry.open ? ' checked' : ''}> Open</label>
      <span class="schedule-range">
        <label for="${id('start')}">Receiving</label>
        <input type="time" id="${id('start')}" data-field="start" value="${window.start || ''}"${disabled}>
        <span aria-hidden="true">–</span>
        <label class="visually-hidden" for="${id('end')}">Receiving end</label>
        <input type="time" id="${id('end')}" data-field="end" value="${window.end || ''}"${disabled}>
      </span>
      <span class="schedule-range">
        <label for="${id('breakStart')}">Break</label>
        <input type="time" id="${id('breakStart')}" data-field="breakStart" value="${block.start || ''}"${disabled}>
        <span aria-hidden="true">–</span>
        <label class="visually-hidden" for="${id('breakEnd')}">Break end</label>
        <input type="time" id="${id('breakEnd')}" data-field="breakEnd" value="${block.end || ''}"${disabled}>
      </span>
    </fieldset>`;
  }

  function render(container, schedule, { idPrefix = 'schedule', onChange } = {}) {
    if (!container) return;
    const value = C().cloneSchedule(schedule || C().defaultSchedule());
    container.classList.add('schedule-editor');
    container.innerHTML = C().DAY_KEYS.map((day) => row(day, value[day], idPrefix)).join('');
    if (container.dataset.bound !== 'true') {
      container.dataset.bound = 'true';
      container.addEventListener('change', (event) => {
        if (event.target.dataset.field === 'open') {
          const fieldset = event.target.closest('.schedule-day');
          fieldset.querySelectorAll('input[type="time"]').forEach((input) => {
            input.disabled = !event.target.checked;
            // Opening a day with no hours starts from the standard weekday hours.
            if (event.target.checked && !input.value) {
              const fallback = C().defaultSchedule().monday;
              const field = input.dataset.field;
              input.value = field === 'start' ? fallback.windows[0].start : field === 'end' ? fallback.windows[0].end : '';
            }
          });
        }
        container.dispatchEvent(new CustomEvent('schedule-change', { bubbles: true }));
        if (typeof container._onChange === 'function') container._onChange(read(container));
      });
    }
    container._onChange = onChange;
  }

  function read(container) {
    const schedule = {};
    C().DAY_KEYS.forEach((day) => {
      const fieldset = container.querySelector(`.schedule-day[data-day="${day}"]`);
      const get = (field) => fieldset?.querySelector(`[data-field="${field}"]`);
      const open = !!get('open')?.checked;
      if (!open) {
        schedule[day] = { open: false, windows: [], breaks: [] };
        return;
      }
      const breakStart = get('breakStart')?.value || '';
      const breakEnd = get('breakEnd')?.value || '';
      schedule[day] = {
        open: true,
        windows: [{ start: get('start')?.value || '', end: get('end')?.value || '' }],
        // A break is optional; a half-filled break is kept so validation can explain it.
        breaks: breakStart || breakEnd ? [{ start: breakStart, end: breakEnd }] : []
      };
    });
    return schedule;
  }

  global.GoRouteXScheduleEditor = { render, read };
})(typeof window !== 'undefined' ? window : globalThis);
