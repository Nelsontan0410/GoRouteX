/**
 * Phase 1D: unchanged Manual Assignment page rendering and orchestration.
 * Classic script: declaration-only loading; original bootstrap and UI bindings remain in app.html/planning-page.js.
 * Uses live planning-state slots/selections and app.html DOM, stop, map and access helpers.
 * Page controls call existing finalization helpers; neither module owns a second state store.
 * Native handlers and rendering call each other via existing global declarations (no module import cycle).
 * All duplicate declarations are retained in original order: trailing compatibility wrappers win.
 * Existing updateRouteLines preview calls and Retrieve All session sync are intentionally preserved.
 */
async function handleGoToManualAssignPage() {
        if (!currentLocationOrigin) { 
            messageBarPg2.textContent = "Location not set. Please wait or enable location services.";
            requestCurrentLocation(); return; 
        }
        if (selectedCustomers.size === 0) { 
            messageBarPg2.textContent = "No stops selected. Go back to select stops.";
                return;
            }
        // Use customer IDs instead of addresses to preserve identity
        unassignedStops = Array.from(selectedCustomers); 
        resetManualRouteSlots();

        // Populate addressToInitialIndexMap for consistent numbering on Page 2
        addressToInitialIndexMap.clear();
        Array.from(selectedCustomers).forEach((customerId, index) => {
            const customer = getCustomerById(customerId);
            if (customer) {
                addressToInitialIndexMap.set(customer.Address, index + 1);
            }
        });
        
        await showPage('page-manual-assign');
        populateManualAssignmentLists(); 
        addSimpleMarkersForMasterList(unassignedStops.concat(getAssignedStopIds())); 
        
        hasShownOptimizationSuggestion = true;
        messageBarPg2.textContent = window._autoPlanManualMode
            ? 'Automatic planning for today is used up. Drag the stops into routes yourself, then click Confirm Route.'
            : ['Routes generated. Adjust stops or use map detours if needed, then click Confirm Route.', window._timeWindowPlanningNotice || ''].filter(Boolean).join(' ');
        updateRouteLines();
        updateConfirmRouteButtonState();
    }

function populateManualAssignmentLists() {
        renderDraggableList(unassignedStopsListDiv, unassignedStops, 'unassigned', -1);
        renderDraggableList(manualRoute1ListDiv, manualRoute1Waypoints, 'route1', 0);
        renderDraggableList(manualRoute2ListDiv, manualRoute2Waypoints, 'route2', 1);
    }

function renderDraggableList(listElement, itemsArray, listType, routeIndexIfApplicable) {
        // For unassigned list, use traditional draggable items
        if (listType === 'unassigned') {
            listElement.innerHTML = '';
            if (itemsArray.length === 0) {
                listElement.innerHTML = '<em>All stops assigned!</em>';
                return;
            }

            const listFragment = document.createDocumentFragment();
            itemsArray.forEach((customerId, i) => {
                const customer = getCustomerById(customerId);
                if (!customer) return;

                const div = document.createElement('div');
                const initialIndex = addressToInitialIndexMap.get(customer.Address) || (i + 1);
                div.textContent = `${initialIndex}. ${customer.Name || 'Unknown'} - ${customer.Address}`;

                div.className = 'draggable-item';
                div.setAttribute('draggable', 'true');
                div.setAttribute('data-customer-id', customerId);
                div.setAttribute('data-address', customer.Address);
                div.setAttribute('data-list-type', listType);
                div.setAttribute('data-current-index', i);
                listFragment.appendChild(div);
            });
            listElement.appendChild(listFragment);
            attachDragListenersToUnassignedList(listElement);
        } else {
            // For route slots, update the 8 fixed slots
            renderRouteSlots(listElement, itemsArray, listType);
        }
    }

function removeFromSlot(listType, slotIndex) {
        const removedCustomerId = getRouteSlotEntry(listType, slotIndex)?.location || null;
        if (!removedCustomerId) return;
        clearRouteSlot(listType, slotIndex);
        syncManualWaypointsFromSlots();
        if (!unassignedStops.includes(removedCustomerId)) {
            unassignedStops.push(removedCustomerId);
        }
        refreshManualAssignmentUi();
    }

function getStayPresetValue(stayMinutes) {
        const normalized = normalizeStayMinutes(stayMinutes);
        return STAY_TIME_PRESETS.includes(normalized) ? String(normalized) : 'custom';
    }

function buildStaySelectOptions(stayMinutes) {
        const selectedValue = getStayPresetValue(stayMinutes);
        const presetOptions = STAY_TIME_PRESETS.map((minutes) =>
            `<option value="${minutes}"${selectedValue === String(minutes) ? ' selected' : ''}>${minutes} min</option>`
        ).join('');
        return `${presetOptions}<option value="custom"${selectedValue === 'custom' ? ' selected' : ''}>Custom</option>`;
    }

function getEmptyRouteSlotMarkup(index, listType) {
        return `
            <div class="slot-layout">
                <span class="slot-number">${index + 1}</span>
                <span class="slot-content">Drop here</span>
            </div>
        `;
    }

function ensureRouteSlotSkeleton(container, listType) {
        const existingSlots = container.querySelectorAll('.route-slot');
        if (existingSlots.length === MAX_WAYPOINTS_PER_ROUTE) return;

        container.innerHTML = Array.from({ length: MAX_WAYPOINTS_PER_ROUTE }, (_, index) =>
            `<div class="route-slot empty" data-slot="${index}" data-list-type="${listType}">${getEmptyRouteSlotMarkup(index, listType)}</div>`
        ).join('');
    }

function stopRouteSlotControlInteraction(event) {
        event.stopPropagation();
        if (event.type === 'dragstart') {
            event.preventDefault();
        }
    }

function updateRouteSlotStay(listType, slotIndex, stayMinutes) {
        const slotEntry = getRouteSlotEntry(listType, slotIndex);
        if (!slotEntry || !slotEntry.location) return;
        setRouteSlotEntry(listType, slotIndex, {
            location: slotEntry.location,
            stay: normalizeStayMinutes(stayMinutes)
        });
    }

function handleStayTimePresetChange(event) {
        const select = event.currentTarget;
        const listType = select.dataset.listType;
        const slotIndex = Number.parseInt(select.dataset.slot, 10);
        const slotElement = select.closest('.route-slot');
        const customInput = slotElement?.querySelector('.slot-stay-custom');
        const customUnit = slotElement?.querySelector('.slot-stay-unit');

        if (select.value === 'custom') {
            const currentStay = getRouteSlotEntry(listType, slotIndex)?.stay || getDefaultStayMinutes();
            if (customInput) {
                customInput.hidden = false;
                customInput.value = currentStay;
                customInput.focus();
                customInput.select();
            }
            if (customUnit) customUnit.hidden = false;
            return;
        }

        updateRouteSlotStay(listType, slotIndex, Number.parseInt(select.value, 10));
        if (customInput) customInput.hidden = true;
        if (customUnit) customUnit.hidden = true;
    }

function handleStayTimeCustomChange(event) {
        const input = event.currentTarget;
        const listType = input.dataset.listType;
        const slotIndex = Number.parseInt(input.dataset.slot, 10);
        const stayMinutes = Number.parseInt(input.value, 10);

        if (!Number.isFinite(stayMinutes) || stayMinutes <= 0) {
            input.value = getRouteSlotEntry(listType, slotIndex)?.stay || getDefaultStayMinutes();
            return;
        }

        updateRouteSlotStay(listType, slotIndex, stayMinutes);
    }

function getCombinedRouteSlotPositions() {
        return getActiveManualRouteKeys().flatMap((listType) =>
            getRouteSlotKeys().map((slotKey) => ({
                listType,
                slotIndex: Number(slotKey) - 1
            }))
        );
    }

function getFirstEmptyRouteSlotPosition() {
        return getCombinedRouteSlotPositions().find((position) => {
            const slotEntry = getRouteSlotEntry(position.listType, position.slotIndex);
            return !slotEntry?.location;
        }) || null;
    }

function getAdjacentOccupiedRouteSlotPosition(listType, slotIndex, direction) {
        const positions = getCombinedRouteSlotPositions();
        const currentPositionIndex = positions.findIndex((position) =>
            position.listType === listType && position.slotIndex === slotIndex
        );
        if (currentPositionIndex < 0) return null;

        const step = direction === 'up' ? -1 : 1;
        for (let index = currentPositionIndex + step; index >= 0 && index < positions.length; index += step) {
            const position = positions[index];
            const slotEntry = getRouteSlotEntry(position.listType, position.slotIndex);
            if (slotEntry?.location) return position;
        }
        return null;
    }

function hasAdjacentOccupiedRouteSlot(listType, slotIndex, direction) {
        return !!getAdjacentOccupiedRouteSlotPosition(listType, slotIndex, direction);
    }

function setManualAssignmentMessage(message) {
        if (messageBarPg2) {
            messageBarPg2.textContent = message;
        }
    }

function addUnassignedStopToNextRouteSlot(customerId) {
        if (!customerId || !unassignedStops.includes(customerId)) return;

        const emptySlot = getFirstEmptyRouteSlotPosition();
        if (!emptySlot) {
            setManualAssignmentMessage('All route slots are full. Remove a stop before adding another.');
            return;
        }

        unassignedStops = unassignedStops.filter((stopId) => stopId !== customerId);
        setRouteSlotEntry(emptySlot.listType, emptySlot.slotIndex, {
            location: customerId,
            stay: getDefaultStayMinutesForStop(customerId)
        });
        syncManualWaypointsFromSlots();
        refreshManualAssignmentUi();
        setManualAssignmentMessage(`Added stop to ${getManualRouteGroupLabel(emptySlot.listType)} slot ${emptySlot.slotIndex + 1}.`);
    }

function moveRouteSlotSequence(listType, slotIndex, direction) {
        const currentEntry = getRouteSlotEntry(listType, slotIndex);
        if (!currentEntry?.location) return;

        const targetPosition = getAdjacentOccupiedRouteSlotPosition(listType, slotIndex, direction);
        if (!targetPosition) return;

        const targetEntry = getRouteSlotEntry(targetPosition.listType, targetPosition.slotIndex);
        setRouteSlotEntry(targetPosition.listType, targetPosition.slotIndex, currentEntry);
        setRouteSlotEntry(listType, slotIndex, targetEntry);
        syncManualWaypointsFromSlots();
        refreshManualAssignmentUi();
        setManualAssignmentMessage('Route stop order updated.');
    }

function attachRouteSlotControlListeners(container) {
        container.querySelectorAll('.slot-stay-select').forEach((select) => {
            select.addEventListener('change', handleStayTimePresetChange);
            ['mousedown', 'click', 'dragstart'].forEach((eventName) => {
                select.addEventListener(eventName, stopRouteSlotControlInteraction);
            });
        });

        container.querySelectorAll('.slot-stay-custom').forEach((input) => {
            input.addEventListener('change', handleStayTimeCustomChange);
            ['mousedown', 'click', 'dragstart'].forEach((eventName) => {
                input.addEventListener(eventName, stopRouteSlotControlInteraction);
            });
        });

        container.querySelectorAll('.slot-move-btn').forEach((button) => {
            button.addEventListener('click', (event) => {
                stopRouteSlotControlInteraction(event);
                moveRouteSlotSequence(
                    button.dataset.listType,
                    Number.parseInt(button.dataset.slot, 10),
                    button.dataset.direction
                );
            });
            ['mousedown', 'dragstart'].forEach((eventName) => {
                button.addEventListener(eventName, stopRouteSlotControlInteraction);
            });
        });

        container.querySelectorAll('.slot-remove-btn').forEach((button) => {
            button.addEventListener('click', (event) => {
                stopRouteSlotControlInteraction(event);
                removeFromSlot(button.dataset.listType, Number.parseInt(button.dataset.slot, 10));
            });
            ['mousedown', 'dragstart'].forEach((eventName) => {
                button.addEventListener(eventName, stopRouteSlotControlInteraction);
            });
        });
    }

function refreshManualAssignmentUi() {
        populateManualAssignmentLists();
        addSimpleMarkersForMasterList(unassignedStops.concat(getAssignedStopIds()));
        updateRouteLines();
        updateConfirmRouteButtonState();
    }

async function handleGoToManualAssignPageLegacy() {
        if (!hasRolePermission('routes.manage')) {
            promptForRoleRestriction({
                title: 'Route assignment is restricted',
                message: 'Your current role can review routes but cannot create or assign new plans.'
            });
            return;
        }
        if (!canStartNewRoutePlan()) {
            return;
        }
        if (selectedCustomers.size === 0) {
            messageBarPg2.textContent = "No stops selected. Go back to select stops.";
            return;
        }
        if (!ensureOriginReadyForPlanning()) return;
        if (!routeArrangementIsDirectionReturn() && !ensureEndLocationReadyForPlanning()) return;

        let selectedStops = getSelectedStopObjects();
        if (selectedStops.some((stop) => stop.isPlaceholder)) {
            messageBarPg2.textContent = 'Loading selected stop details before route planning...';
            try {
                await refreshFullStopsInBackground();
                selectedStops = getSelectedStopObjects();
            } catch (error) {
                console.warn('Full selected stop detail refresh failed:', error);
            }

            if (selectedStops.some((stop) => stop.isPlaceholder)) {
                messageBarPg2.textContent = 'Some selected stops are still loading. Please wait a moment and try again.';
                showToast('Selected stop details are still loading.', 'warning', 3600);
                return;
            }
        }
        // Every entry into Review & Assign uses one automatic plan (server-counted, including re-entries).
        // With none left today, the stops are listed unassigned and the planner arranges them by hand.
        const autoPlan = await startAutoPlanSession();
        window._autoPlanManualMode = autoPlan.mode === 'manual';
        window._autoPlanRecord = null;
        if (autoPlan.mode === 'manual') {
            window._autoPlanRecord = { source: 'manual', routes: [], unassigned: Array.from(selectedCustomers), at: new Date().toISOString() };
            unassignedStops = Array.from(selectedCustomers);
            resetManualRouteSlots();
            openRouteLimitReachedModal(getUsageStatus('activeRoutes'));
        } else try {
            window._autoPlanSessionId = autoPlan.sessionId;
            await generateOptimizedActiveRoutesFromSelection(selectedStops, 8);
            buildManualRouteSlotsFromActiveRoutes(window._activeRoutes);
            if (routeArrangementIsDirectionReturn()) recordDirectionDebug('SUCCESS', 'Direction order applied; opening manual preview');
            // Customers the planner could not fit stay unassigned for the planner to handle.
            unassignedStops = Array.isArray(window._plannerUnassignedIds) ? [...window._plannerUnassignedIds] : [];
            // Remember the automatic plan to measure later how much the planner changed it (plan-edits.js).
            window._autoPlanRecord = {
                source: window._plannerUsedEngine ? 'plan-engine' : 'google',
                routes: (window._activeRoutes || []).map((route) => [...(route.stopIds || [])]),
                unassigned: [...unassignedStops],
                at: new Date().toISOString()
            };
        } catch (error) {
            if (routeArrangementIsDirectionReturn()) {
                messageBarPg2.textContent = `Direction plan was not applied: ${error.message || 'Unable to order these stops.'}`;
                const errorDetail = String(error?.message || error?.status || error?.code || error || 'Unknown error');
                recordDirectionDebug('FAILED', `${error?.name || 'Error'}: ${errorDetail}`);
                const debugPanel = document.getElementById('directionDebugPanel');
                if (debugPanel) debugPanel.open = true;
                const failureMessage = `Direction order failed: ${errorDetail} Your previous route was kept.`;
                if (routeArrangementStatus) routeArrangementStatus.textContent = failureMessage;
                console.error('Direction order failed', error);
                showToast(failureMessage, 'warning', 10000);
                await refundAutoPlanSession(autoPlan.sessionId);
                return;
            }
            console.warn('Global route optimization failed. Falling back to route engine grouping.', error);
            if (window.GoRouteXRouteEngine) {
                window.GoRouteXRouteEngine.setSelectedStops(selectedStops);
                window.GoRouteXRouteEngine.generateRoutes(8);
                const fallbackPlan = window.GoRouteXRouteEngine.getRoutePlan().routes || [];
                const fallbackStops = fallbackPlan.flatMap((route) => Array.isArray(route?.stops) ? route.stops : []);
                window._activeRoutes = assignRouteColors(splitOptimizedStopsIntoPackedRoutes(fallbackStops, 8));
                window._testRoutes = window._activeRoutes;
                validatePackedActiveRoutes(window._activeRoutes, 8);
                buildManualRouteSlotsFromActiveRoutes(window._activeRoutes);
                unassignedStops = [];
            } else {
                console.warn('GoRouteXRouteEngine is not loaded.');
                unassignedStops = Array.from(selectedCustomers);
                resetManualRouteSlots();
                await refundAutoPlanSession(autoPlan.sessionId);
            }
        }

        addressToInitialIndexMap.clear();
        Array.from(selectedCustomers).forEach((customerId, index) => {
            const customer = getCustomerById(customerId);
            if (customer) {
                addressToInitialIndexMap.set(customer.Address, index + 1);
            }
        });

        await showPage('page-manual-assign');
        updateRouteOriginControls();
        populateManualAssignmentLists();
        addSimpleMarkersForMasterList(unassignedStops.concat(getAssignedStopIds()));

        if (!currentLocationOrigin) {
            if (routeOriginMode === 'current') {
                messageBarPg2.textContent = 'Fetching your current location. You can switch to Enter Address if GPS is unavailable.';
                requestCurrentLocation();
            } else {
                messageBarPg2.textContent = 'Select a custom start address, then drag stops into the route slots.';
            }
            return;
        }

        hasShownOptimizationSuggestion = true;
        messageBarPg2.textContent = window._autoPlanManualMode
            ? 'Automatic planning for today is used up. Drag the stops into routes yourself, then click Confirm Route.'
            : ['Routes generated. Adjust stops or use map detours if needed, then click Confirm Route.', window._timeWindowPlanningNotice || ''].filter(Boolean).join(' ');
        updateRouteLines();
        updateConfirmRouteButtonState();
    }

function populateManualAssignmentListsLegacy() {
        syncManualWaypointsFromSlots();
        renderDraggableList(unassignedStopsListDiv, unassignedStops, 'unassigned', -1);
        renderDynamicManualRouteGroups();
    }

function renderDynamicManualRouteGroups() {
        const routesSection = document.getElementById('routesSection');
        if (!routesSection) return;

        const routeKeys = getActiveManualRouteKeys();
        if (routeKeys.length === 0) {
            manualRouteSlots = {
                route1: createEmptyRouteSlots(),
                route2: createEmptyRouteSlots()
            };
            syncManualWaypointsFromSlots();
        }

        routesSection.innerHTML = getActiveManualRouteKeys().map((routeKey) => {
            const routeNumber = getRouteKeyIndex(routeKey) + 1;
            const routeColor = getRouteColor(routeNumber - 1);
            return `
                <div id="routeDynamicSection${routeNumber}" class="route-card" style="border-left: 5px solid ${routeColor};">
                    <div class="collapsible-section route-list-wrapper" id="manualRoute${routeNumber}Wrapper">
                        <div class="collapsible-header route-header" style="border-left: 5px solid ${routeColor};">${escapeHtml(getManualRouteGroupLabel(routeKey))} (${MAX_WAYPOINTS_PER_ROUTE} Stops)</div>
                        <div class="collapsible-content active">
                            <div class="route-slots-container" id="manualRoute${routeNumber}ListContainer" data-list-type="${routeKey}" data-route-index="${routeNumber - 1}"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        getActiveManualRouteKeys().forEach((routeKey) => {
            const routeNumber = getRouteKeyIndex(routeKey) + 1;
            const routeContainer = document.getElementById(`manualRoute${routeNumber}ListContainer`);
            if (routeContainer) {
                renderDraggableList(routeContainer, getRouteWaypointIds(routeKey), routeKey, routeNumber - 1);
            }
        });
    }

function attachUnassignedStopActionListeners(listElement) {
        listElement.querySelectorAll('.manual-stop-add-btn').forEach((button) => {
            button.addEventListener('click', (event) => {
                stopRouteSlotControlInteraction(event);
                addUnassignedStopToNextRouteSlot(button.dataset.customerId);
            });
            ['mousedown', 'dragstart'].forEach((eventName) => {
                button.addEventListener(eventName, stopRouteSlotControlInteraction);
            });
        });
    }

function renderDraggableListLegacy(listElement, itemsArray, listType, routeIndexIfApplicable) {
        if (listType === 'unassigned') {
            listElement.innerHTML = '';
            if (itemsArray.length === 0) {
                listElement.innerHTML = '<em>All stops assigned!</em>';
                return;
            }

            const listFragment = document.createDocumentFragment();
            itemsArray.forEach((customerId, i) => {
                const customer = getStopDisplayDataById(customerId);
                if (!customer) return;

                const div = document.createElement('div');
                const initialIndex = customer.Address && addressToInitialIndexMap.has(customer.Address)
                    ? addressToInitialIndexMap.get(customer.Address)
                    : (i + 1);
                const stopLabel = `${initialIndex}. ${customer.Name || 'Unknown'} - ${customer.Address}`;

                div.className = 'draggable-item';
                div.setAttribute('draggable', 'true');
                div.setAttribute('data-customer-id', customerId);
                div.setAttribute('data-address', customer.Address);
                div.setAttribute('data-list-type', listType);
                div.setAttribute('data-current-index', i);
                div.innerHTML = `
                    <span class="unassigned-stop-text">${escapeHtml(stopLabel)}</span>
                    <button type="button" class="manual-stop-add-btn" data-customer-id="${escapeHtml(customerId)}">Add</button>
                `;
                listFragment.appendChild(div);
            });
            listElement.appendChild(listFragment);
            attachDragListenersToUnassignedList(listElement);
            attachUnassignedStopActionListeners(listElement);
        } else {
            renderRouteSlots(listElement, itemsArray, listType);
        }
    }

function renderRouteSlotsLegacy(container, itemsArray, listType) {
        ensureRouteSlotSkeleton(container, listType);
        const slots = container.querySelectorAll('.route-slot');

        slots.forEach((slot, index) => {
            const slotEntry = getRouteSlotEntry(listType, index);
            const customerId = slotEntry?.location || null;

            slot.setAttribute('data-slot', String(index));
            slot.setAttribute('data-list-type', listType);

            if (customerId) {
                const customer = getStopDisplayDataById(customerId);

                const stayMinutes = normalizeStayMinutes(slotEntry.stay);
                const isCustomStay = getStayPresetValue(stayMinutes) === 'custom';
                const mapMarkerNumber = getStopMapMarkerNumber(customerId);
                const canMoveUp = hasAdjacentOccupiedRouteSlot(listType, index, 'up');
                const canMoveDown = hasAdjacentOccupiedRouteSlot(listType, index, 'down');
                slot.classList.remove('empty');
                slot.classList.add('filled');
                slot.setAttribute('data-customer-id', customerId);
                slot.setAttribute('draggable', 'true');
                slot.innerHTML = `
                    <div class="slot-layout">
                        <span class="slot-number">${index + 1}</span>
                        <div class="slot-details">
                            <span class="slot-content">${escapeHtml(customer.Name || 'Unknown')} - ${escapeHtml(customer.Address || 'Loading stop details...')}</span>
                            <div class="slot-stay-row">
                                <span class="slot-stay-label">Stay</span>
                                <select class="slot-stay-select" data-list-type="${listType}" data-slot="${index}">
                                    ${buildStaySelectOptions(stayMinutes)}
                                </select>
                                <input type="number" min="1" step="5" class="slot-stay-custom" data-list-type="${listType}" data-slot="${index}" value="${stayMinutes}"${isCustomStay ? '' : ' hidden'}>
                                <span class="slot-stay-unit"${isCustomStay ? '' : ' hidden'}>min</span>
                                <span class="slot-marker-ref" title="Map marker number">Map #${escapeHtml(String(mapMarkerNumber))}</span>
                            </div>
                        </div>
                        <button type="button" class="slot-move-btn" data-list-type="${listType}" data-slot="${index}" data-direction="up"${canMoveUp ? '' : ' disabled'}>Up</button>
                        <button type="button" class="slot-move-btn" data-list-type="${listType}" data-slot="${index}" data-direction="down"${canMoveDown ? '' : ' disabled'}>Down</button>
                        <button type="button" class="slot-remove-btn" data-list-type="${listType}" data-slot="${index}">×</button>
                    </div>
                `;
            } else {
                slot.classList.add('empty');
                slot.classList.remove('filled');
                slot.removeAttribute('data-customer-id');
                slot.removeAttribute('draggable');
                slot.innerHTML = getEmptyRouteSlotMarkup(index, listType);
            }
        });

        attachRouteSlotControlListeners(container);
        attachDragListenersToSlots(container);
    }

function removeFromSlotLegacy(listType, slotIndex) {
        const slotEntry = getRouteSlotEntry(listType, slotIndex);
        if (!slotEntry || !slotEntry.location) return;

        if (!unassignedStops.includes(slotEntry.location)) {
            unassignedStops.push(slotEntry.location);
        }
        clearRouteSlot(listType, slotIndex);
        syncManualWaypointsFromSlots();
        refreshManualAssignmentUi();
    }

function retrieveAllStopsFromRoutes() {
        const assignedStopIds = getAssignedStopIds();
        if (assignedStopIds.length === 0) {
            showToast('No assigned route stops to retrieve.', 'info', 3000);
            updateConfirmRouteButtonState();
            return;
        }

        const selectedStopOrder = Array.from(selectedCustomers);
        const unassignedSet = new Set(unassignedStops);
        assignedStopIds.forEach((customerId) => {
            if (selectedCustomers.has(customerId)) {
                unassignedSet.add(customerId);
            }
        });

        unassignedStops = selectedStopOrder.filter((customerId) => unassignedSet.has(customerId));
        getActiveManualRouteKeys().forEach((routeKey) => {
            getRouteSlotKeys().forEach((_slotKey, index) => clearRouteSlot(routeKey, index));
        });
        syncManualWaypointsFromSlots();
        AppState.plannedRoutes = [];
        window.plannedRoutes = AppState.plannedRoutes;
        currentRouteConfirmationState = {
            saved: false,
            saving: false,
            historyId: null,
            source: 'draft'
        };
        hideConfirmRouteModal();
        clearRouteLines();
        refreshManualAssignmentUi();
        syncSessionToCloud();
        setManualAssignmentMessage('All assigned route stops moved back to Unassigned Selected Stops.');
        showToast('All route stops retrieved to unassigned.', 'success', 3200);
    }

async function handleGoToManualAssignPage(...args) { return handleGoToManualAssignPageLegacy(...args); }

function populateManualAssignmentLists(...args) { return populateManualAssignmentListsLegacy(...args); }

function renderDraggableList(...args) { return renderDraggableListLegacy(...args); }

function renderRouteSlots(...args) { return renderRouteSlotsLegacy(...args); }

function removeFromSlot(...args) { return removeFromSlotLegacy(...args); }
