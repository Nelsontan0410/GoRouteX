const UI = (() => {
    function clearContainer(container) {
        if (container) {
            container.innerHTML = '';
        }
    }

    function getActiveRouteIndex() {
        const routeIndex = AppState.plannedRoutes.findIndex((route) => route && route.id === activeRouteId);
        return routeIndex >= 0 ? routeIndex : 0;
    }

    function updateActiveTabUI() {
        if (!routeSwitcherContainerPg3) return;
        routeSwitcherContainerPg3.querySelectorAll('.route-tab').forEach((btn) => {
            btn.classList.toggle('active-route-btn', Number(btn.dataset.routeId) === activeRouteId);
        });
    }

    function renderActiveRoute() {
        const routeIndex = getActiveRouteIndex();
        if (!AppState.plannedRoutes[routeIndex]) return;
        renderOptimizedRouteOnMap(routeIndex);
    }

    function populateOptimizedRouteLists() {
        if (route2InfoSection) {
            route2InfoSection.style.display = 'none';
        }

        const activeRoute = AppState.plannedRoutes.find((route) => route && route.id === activeRouteId)
            || AppState.plannedRoutes.find((route) => route && route.directionsResult);
        if (!activeRoute) {
            if (route1InfoSection) route1InfoSection.style.display = 'none';
            return;
        }

        activeRouteId = activeRoute.id;
        const activeRouteIndex = AppState.plannedRoutes.findIndex((route) => route && route.id === activeRoute.id);
        const routeColor = activeRoute.color || getRouteColor(activeRouteIndex);
        const routeHeader = route1InfoSection?.querySelector('.route-info-header span');
        const routeIcon = route1InfoSection?.querySelector('.route-icon');
        const routeShareBtn = shareRoute1Btn;
        const waypoints = Array.isArray(activeRoute.optimizedStops)
            ? activeRoute.optimizedStops
                .slice(1)
                .filter((stopId) => !isRouteConfiguredEndStop(activeRoute, stopId))
            : [];

        if (route1InfoSection) {
            route1InfoSection.style.display = 'block';
            route1InfoSection.style.borderLeft = `5px solid ${routeColor}`;
        }
        if (routeHeader) routeHeader.textContent = `Route ${activeRoute.id} Updates & Feedback`;
        if (routeIcon) {
            routeIcon.textContent = String(activeRoute.id);
            routeIcon.style.background = routeColor;
        }
        if (optimizedRoute1ListDiv) {
            optimizedRoute1ListDiv.dataset.routeIndex = String(Math.max(activeRouteIndex, 0));
        }
        if (routeShareBtn) {
            routeShareBtn.disabled = !(activeRoute.directionsResult && activeRoute.directionsResult.routes?.length);
            routeShareBtn.title = `Share Route ${activeRoute.id} via WhatsApp`;
        }

        populateOptimizedRouteList(Math.max(activeRouteIndex, 0), waypoints, optimizedRoute1ListDiv, route1InfoSection);
    }

    function populateOptimizedRouteList(routeListIndex, waypoints, listContainer, wrapperElement) {
        if (!listContainer) return;
        listContainer.innerHTML = '';
        const routeData = AppState.plannedRoutes.find(r => r && r.id === (routeListIndex + 1));
        if (wrapperElement && routeData) {
            wrapperElement.style.borderLeft = `5px solid ${routeData.color || getRouteColor(routeListIndex)}`;
        }

        if (routeData && routeData.directionsResult && waypoints && waypoints.length > 0) {
            wrapperElement.style.display = 'block';
            const listFragment = document.createDocumentFragment();
            waypoints.forEach((stopId, i) => {
                if (routeListIndex === 1 && isRouteConfiguredEndStop(routeData, stopId)) return;

                const div = document.createElement('div');
                div.className = 'draggable-item optimized-stop-item';
                div.id = `optimized-stop-${routeListIndex}-${i}`;

                const customer = getCustomerById(stopId);
                const customerName = customer ? customer.Name : (addressNameMap[stopId] || stopId);
                const customerAddress = customer ? customer.Address : stopId;
                const phoneNumber = customer ? customer["Hp No"] : null;

                const contentSpan = document.createElement('span');
                contentSpan.className = 'optimized-stop-item-content optimized-stop-title';
                contentSpan.textContent = `${i + 1}. ${customerName}`;

                const stopTiming = Array.isArray(routeData.detailedStopTimes)
                    ? routeData.detailedStopTimes.find((timing) => timing && (timing.address === customerAddress || timing.address === stopId))
                    : null;
                const stopMeta = document.createElement('div');
                stopMeta.className = 'optimized-stop-details';
                stopMeta.innerHTML = `
                    <div class="optimized-stop-meta">${escapeHtml(customerAddress || 'Address not available')}</div>
                    <div class="optimized-stop-meta">${escapeHtml(phoneNumber && phoneNumber.trim() !== '' ? `Phone: ${phoneNumber.trim()}` : 'Phone: Not saved')}</div>
                    <div class="optimized-stop-meta optimized-stop-contact">${escapeHtml(stopTiming?.arrivalTimeStr ? `ETA ${stopTiming.arrivalTimeStr}` : 'ETA available after schedule generation')}</div>
                `;
                const stopSummary = document.createElement('div');
                stopSummary.className = 'optimized-stop-main';
                stopSummary.appendChild(contentSpan);
                stopSummary.appendChild(stopMeta);
                div.appendChild(stopSummary);

                const actionsContainer = document.createElement('div');
                actionsContainer.className = 'stop-actions';
                const advancedCommsAllowed = getProductFeatureAccess('advancedWhatsappTools').allowed;
                const unableNoticeAllowed = getProductFeatureAccess('whatsappUnableToVisitNotice').allowed;

                if (customerAddress !== fixedDestinationAddress || (routeListIndex === 0 && waypoints.length === 1 && customerAddress === fixedDestinationAddress)) {
                    const whatsappBtn = document.createElement('button');
                    whatsappBtn.className = 'whatsapp-notice-btn';
                    whatsappBtn.textContent = 'WhatsApp';
                    whatsappBtn.dataset.customerName = customerName;
                    whatsappBtn.dataset.customerAddress = customerAddress;
                    whatsappBtn.dataset.routeIndex = routeListIndex;

                    if (phoneNumber && phoneNumber.trim() !== "") {
                        whatsappBtn.dataset.phoneNumber = phoneNumber.trim();
                        if (phoneNumber.trim().length < 6) {
                            appLog(`Warning: Short phone number for ${customerName}: "${phoneNumber}"`);
                        }
                    } else {
                        whatsappBtn.disabled = true;
                        whatsappBtn.title = "Phone number not available";
                        appLog(`WhatsApp button disabled for ${customerName}: No phone number`);
                    }
                    whatsappBtn.onclick = function() {
                        handleSendWhatsAppNotice(
                            this.dataset.customerName,
                            this.dataset.customerAddress,
                            parseInt(this.dataset.routeIndex),
                            this.dataset.phoneNumber
                        );
                    };
                    actionsContainer.appendChild(whatsappBtn);

                    const callBtn = document.createElement('button');
                    callBtn.className = 'stop-call-btn';
                    callBtn.textContent = 'Call';
                    if (phoneNumber && phoneNumber.trim() !== "") {
                        callBtn.onclick = function() {
                            callSpecificStop(customerName, customerAddress, phoneNumber.trim());
                        };
                    } else {
                        callBtn.disabled = true;
                        callBtn.title = "Phone number not available";
                    }
                    actionsContainer.appendChild(callBtn);

                    const voiceBtn = document.createElement('button');
                    voiceBtn.className = 'stop-voice-btn';
                    voiceBtn.textContent = 'Voice';
                    if (phoneNumber && phoneNumber.trim() !== "") {
                        voiceBtn.onclick = function() {
                            if (!advancedCommsAllowed) {
                                promptForProductFeatureAccess('advancedWhatsappTools');
                                return;
                            }
                            sendVoiceMessageToStop(customerName, customerAddress, phoneNumber.trim());
                        };
                        if (!advancedCommsAllowed) {
                            voiceBtn.title = 'Available on ProPlan.';
                        }
                    } else {
                        voiceBtn.disabled = true;
                        voiceBtn.title = "Phone number not available";
                    }
                    actionsContainer.appendChild(voiceBtn);

                    const notAttemptedBtn = document.createElement('button');
                    notAttemptedBtn.className = 'delivery-not-attempted-btn';
                    notAttemptedBtn.textContent = 'Unable';
                    if (phoneNumber && phoneNumber.trim() !== "") {
                        notAttemptedBtn.onclick = function() {
                            if (!unableNoticeAllowed) {
                                promptForProductFeatureAccess('whatsappUnableToVisitNotice');
                                return;
                            }
                            if (confirm(`Send an "unable to visit today" message to ${customerName}?`)) {
                                sendDeliveryNotAttemptedMessage(customerName, customerAddress, phoneNumber.trim());
                            }
                        };
                        if (!unableNoticeAllowed) {
                            notAttemptedBtn.title = 'Upgrade required for unable-to-visit notices.';
                        }
                    } else {
                        notAttemptedBtn.disabled = true;
                        notAttemptedBtn.title = "Phone number not available";
                    }
                    actionsContainer.appendChild(notAttemptedBtn);
                }

                const feedbackBtn = document.createElement('button');
                feedbackBtn.className = 'feedback-request-btn';
                feedbackBtn.textContent = 'Feedback';
                feedbackBtn.dataset.customerName = customerName;
                feedbackBtn.dataset.customerAddress = customerAddress;
                feedbackBtn.dataset.routeIndex = routeListIndex;
                feedbackBtn.dataset.stopItemId = div.id;

                if (phoneNumber && phoneNumber.trim() !== "") {
                    feedbackBtn.dataset.phoneNumber = phoneNumber.trim();
                } else {
                    feedbackBtn.disabled = true;
                    feedbackBtn.title = "Cannot request feedback: Phone number missing.";
                }

                feedbackBtn.onclick = function() {
                    if (!advancedCommsAllowed) {
                        promptForProductFeatureAccess('advancedWhatsappTools');
                        return;
                    }
                    handleRequestFeedback(
                        this.dataset.customerName,
                        this.dataset.customerAddress,
                        parseInt(this.dataset.routeIndex),
                        this.dataset.phoneNumber,
                        this
                    );
                };
                if (phoneNumber && phoneNumber.trim() !== "" && !advancedCommsAllowed) {
                    feedbackBtn.title = 'Available on ProPlan.';
                }
                actionsContainer.appendChild(feedbackBtn);
                div.appendChild(actionsContainer);
                listFragment.appendChild(div);
            });
            listContainer.appendChild(listFragment);
        } else {
            if (routeData && routeData.directionsResult) {
                wrapperElement.style.display = 'block';
                listContainer.innerHTML = '<em>No customer stops were assigned to this route segment.</em>';
            } else if (routeData && !routeData.directionsResult && ((routeListIndex === 0 && manualRoute1Waypoints.length > 0) || (routeListIndex === 1 && manualRoute2Waypoints.length > 0))) {
                wrapperElement.style.display = 'block';
                listContainer.innerHTML = '<em>Route planning failed for this segment. Review the selected stops and try again.</em>';
            } else if (wrapperElement) {
                wrapperElement.style.display = 'none';
            }
        }
    }

    function setupRouteSwitcherPage3() {
        routeSwitcherContainerPg3.innerHTML = '';
        const actualPlannedRoutes = AppState.plannedRoutes.filter(r => r && r.directionsResult);

        if (actualPlannedRoutes.length > 1) {
            actualPlannedRoutes.forEach(route => {
                const originalIndex = AppState.plannedRoutes.findIndex(pr => pr && pr.id === route.id);
                const btn = document.createElement('button');
                btn.textContent = `View Route ${route.id}`;
                btn.className = `route-tab${route.id === activeRouteId ? ' active-route-btn' : ''}`;
                btn.dataset.routeId = String(route.id);
                btn.style.borderLeft = `5px solid ${route.color || getRouteColor(originalIndex)}`;
                btn.onclick = () => {
                    if (AppState.plannedRoutes[originalIndex] && AppState.plannedRoutes[originalIndex].directionsResult) {
                        try { performance.mark('grx:routeTabClick'); performance.mark('grx:routeTabStart'); } catch {}
                        activeRouteId = Number(btn.dataset.routeId);
                        currentViewingRouteIndexPage3 = originalIndex;
                        renderActiveRoute();
                        updateActiveTabUI();
                        try { performance.mark('grx:routeTabEnd'); performance.measure('grx:routeTab', 'grx:routeTabStart', 'grx:routeTabEnd'); } catch {}
                    } else {
                        appLog("Attempted to switch to an invalid or unplanned route index:", originalIndex);
                    }
                };
                routeSwitcherContainerPg3.appendChild(btn);
            });
            routeSwitcherContainerPg3.style.display = 'block';
        } else {
            routeSwitcherContainerPg3.style.display = 'none';
        }
        updateActiveTabUI();
    }

    function onRouteClick(routeId) {
        MapHandler.focusRoute(routeId);
    }

    function updateNavigationButtonsPage3() {
        navigationButtonContainerPage3.innerHTML = '';
    }

    function disablePage3ActionButtons() {
        showEstimatesBtnPage3.disabled = true;
        mapsPreviewBtn.disabled = true;
        startGPSTrackingBtn.disabled = true;
        shareRoute1Btn.disabled = true;
        shareRoute2Btn.disabled = true;

        const navBtns = navigationButtonContainerPage3.querySelectorAll('button');
        navBtns.forEach(btn => btn.disabled = true);
        updateConfirmRouteButtonState();
    }

    function enablePage3ActionButtonsAfterPlan() {
        const hasAnySuccessfulRoute = AppState.plannedRoutes.some(r => r && r.directionsResult);
        showEstimatesBtnPage3.disabled = !hasAnySuccessfulRoute;
        mapsPreviewBtn.disabled = !hasAnySuccessfulRoute;
        startGPSTrackingBtn.disabled = !hasAnySuccessfulRoute;

        const activeRoute = AppState.plannedRoutes.find(r => r && r.id === activeRouteId);
        const activeRouteSuccess = activeRoute && activeRoute.directionsResult && activeRoute.directionsResult.routes && activeRoute.directionsResult.routes.length > 0;
        shareRoute1Btn.disabled = !activeRouteSuccess;
        if (shareRoute2Btn) shareRoute2Btn.disabled = true;

        updateNavigationButtonsPage3();
        updateConfirmRouteButtonState();
    }

    function renderRouteList() {
        return populateOptimizedRouteLists();
    }

    function renderStopsList(...args) {
        if (typeof renderCustomerList === 'function') {
            return renderCustomerList(...args);
        }
        return undefined;
    }

    function updateButtons() {
        return enablePage3ActionButtonsAfterPlan();
    }

    return {
        renderRouteList,
        renderStopsList,
        updateButtons,
        clearContainer,
        renderActiveRoute,
        onRouteClick,
        updateActiveTabUI,
        setupRouteSwitcherPage3,
        updateNavigationButtonsPage3,
        disablePage3ActionButtons,
        enablePage3ActionButtonsAfterPlan
    };
})();

window.UI = UI;
