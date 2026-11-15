/**
 * Phase 1D: unchanged Manual Assignment native drag/drop lifecycle.
 * Classic script: declaration-only loading; original bootstrap and UI bindings remain in app.html/planning-page.js.
 * Uses live planning-state slots/selections and app.html DOM, stop, map and access helpers.
 * Page controls call existing finalization helpers; neither module owns a second state store.
 * Native handlers and rendering call each other via existing global declarations (no module import cycle).
 * All duplicate declarations are retained in original order: trailing compatibility wrappers win.
 * Existing updateRouteLines preview calls and Retrieve All session sync are intentionally preserved.
 */

function attachDragListenersToUnassignedList(listElement) {
        const items = listElement.querySelectorAll('.draggable-item');
        items.forEach(item => {
            item.removeEventListener('dragstart', handleManualDragStart);
            item.removeEventListener('dragend', handleManualDragEnd);
            item.addEventListener('dragstart', handleManualDragStart);
            item.addEventListener('dragend', handleManualDragEnd);
        });
        // Allow drops to unassigned list (for removing from routes)
        listElement.removeEventListener('dragover', handleManualDragOver);
        listElement.removeEventListener('drop', handleManualDrop);
        listElement.addEventListener('dragover', handleManualDragOver);
        listElement.addEventListener('drop', handleManualDrop);
    }

function handleManualDragEnd(e) {
        if (draggedItemElement) { draggedItemElement.classList.remove('dragging'); }
        draggedItemElement = null;
        draggedItemOriginalListType = null;
        // Remove drag-over class from all slots
        document.querySelectorAll('.route-slot.drag-over').forEach(s => s.classList.remove('drag-over'));
    }

function handleSlotDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        e.currentTarget.classList.add('drag-over');
    }

function handleSlotDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    }

function handleManualDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }

function attachDragListenersToSlotsLegacy(container) {
        const slots = container.querySelectorAll('.route-slot');
        slots.forEach((slot) => {
            slot.removeEventListener('dragover', handleSlotDragOver);
            slot.removeEventListener('dragleave', handleSlotDragLeave);
            slot.removeEventListener('drop', handleSlotDrop);
            slot.removeEventListener('dragstart', handleSlotDragStart);
            slot.removeEventListener('dragend', handleManualDragEnd);
            slot.addEventListener('dragover', handleSlotDragOver);
            slot.addEventListener('dragleave', handleSlotDragLeave);
            slot.addEventListener('drop', handleSlotDrop);
            if (slot.classList.contains('filled')) {
                slot.addEventListener('dragstart', handleSlotDragStart);
                slot.addEventListener('dragend', handleManualDragEnd);
            }
        });
    }

function handleSlotDragStartLegacy(e) {
        const slot = e.currentTarget;
        if (!slot.dataset.customerId) return;

        draggedItemElement = slot;
        draggedItemOriginalListType = slot.dataset.listType;
        e.dataTransfer.setData('text/plain', slot.dataset.customerId);
        e.dataTransfer.setData('sourceListType', draggedItemOriginalListType);
        e.dataTransfer.setData('sourceSlotIndex', slot.dataset.slot);
        setTimeout(() => { if(draggedItemElement) draggedItemElement.classList.add('dragging'); }, 0);
    }

function handleManualDragStartLegacy(e) {
        draggedItemElement = e.currentTarget;
        draggedItemOriginalListType = e.currentTarget.dataset.listType;
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.customerId);
        e.dataTransfer.setData('sourceListType', draggedItemOriginalListType);
        e.dataTransfer.setData('sourceSlotIndex', '');
        setTimeout(() => { if(draggedItemElement) draggedItemElement.classList.add('dragging'); }, 0);
    }

function handleSlotDropLegacy(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');

        if (!draggedItemElement) return;

        const targetSlot = e.currentTarget;
        const targetListType = targetSlot.dataset.listType;
        const targetSlotIndex = Number.parseInt(targetSlot.dataset.slot, 10);
        const draggedCustomerId = e.dataTransfer.getData('text/plain');
        const sourceListType = e.dataTransfer.getData('sourceListType');
        const sourceSlotIndexRaw = e.dataTransfer.getData('sourceSlotIndex');
        const sourceSlotIndex = sourceSlotIndexRaw === '' ? null : Number.parseInt(sourceSlotIndexRaw, 10);

        if (!draggedCustomerId || !targetListType || Number.isNaN(targetSlotIndex)) return;

        if (sourceListType === targetListType && sourceSlotIndex === targetSlotIndex) {
            handleManualDragEnd();
            return;
        }

        if (sourceListType === 'unassigned') {
            unassignedStops = unassignedStops.filter((id) => id !== draggedCustomerId);
            const displacedStop = getRouteSlotEntry(targetListType, targetSlotIndex)?.location;
            if (displacedStop && !unassignedStops.includes(displacedStop)) {
                unassignedStops.push(displacedStop);
            }
            setRouteSlotEntry(targetListType, targetSlotIndex, {
                location: draggedCustomerId,
                stay: getDefaultStayMinutes()
            });
        } else if (isManualRouteListType(sourceListType) && sourceSlotIndex !== null && !Number.isNaN(sourceSlotIndex)) {
            const sourceEntry = { ...getRouteSlotEntry(sourceListType, sourceSlotIndex) };
            const targetEntry = { ...getRouteSlotEntry(targetListType, targetSlotIndex) };
            if (!sourceEntry.location) {
                handleManualDragEnd();
                return;
            }

            if (targetEntry.location) {
                setRouteSlotEntry(targetListType, targetSlotIndex, sourceEntry);
                setRouteSlotEntry(sourceListType, sourceSlotIndex, targetEntry);
            } else {
                setRouteSlotEntry(targetListType, targetSlotIndex, sourceEntry);
                clearRouteSlot(sourceListType, sourceSlotIndex);
            }
        }

        syncManualWaypointsFromSlots();
        draggedItemElement = null;
        draggedItemOriginalListType = null;
        refreshManualAssignmentUi();
    }

function handleManualDropLegacy(e) {
        e.preventDefault();
        if (!draggedItemElement) { appLog("No draggedItemElement in handleManualDrop"); return; }

        const targetListElement = e.currentTarget;
        if (!targetListElement || targetListElement.id !== 'unassignedStopsList') return;

        let draggedCustomerId = e.dataTransfer.getData('text/plain');
        let sourceListType = e.dataTransfer.getData('sourceListType');
        const sourceSlotIndexRaw = e.dataTransfer.getData('sourceSlotIndex');
        const sourceSlotIndex = sourceSlotIndexRaw === '' ? null : Number.parseInt(sourceSlotIndexRaw, 10);

        if (!draggedCustomerId && draggedItemElement?.dataset.customerId) draggedCustomerId = draggedItemElement.dataset.customerId;
        if (!sourceListType && draggedItemElement?.dataset.listType) sourceListType = draggedItemElement.dataset.listType;

        if (!draggedCustomerId || !sourceListType) {
            appLog("Critical error: Cannot determine dragged item customer ID or source list type.");
            handleManualDragEnd();
            return;
        }

        if (sourceListType === 'unassigned') {
            handleManualDragEnd();
            return;
        }

        if (isManualRouteListType(sourceListType) && sourceSlotIndex !== null && !Number.isNaN(sourceSlotIndex)) {
            clearRouteSlot(sourceListType, sourceSlotIndex);
        }

        if (!unassignedStops.includes(draggedCustomerId)) {
            unassignedStops.push(draggedCustomerId);
        }

        syncManualWaypointsFromSlots();
        draggedItemElement = null;
        draggedItemOriginalListType = null;
        refreshManualAssignmentUi();
    }

function attachDragListenersToSlots(...args) { return attachDragListenersToSlotsLegacy(...args); }

function handleSlotDragStart(...args) { return handleSlotDragStartLegacy(...args); }

function handleManualDragStart(...args) { return handleManualDragStartLegacy(...args); }

function handleSlotDrop(...args) { return handleSlotDropLegacy(...args); }

function handleManualDrop(...args) { return handleManualDropLegacy(...args); }
