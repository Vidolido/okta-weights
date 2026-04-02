/**
 * KPI Processor
 * Processes raw session + event data into clean KPI records.
 * Ported from KpiProcessor.cs in the original OktaData project.
 */

function processSession(session, events) {
    if (!session || !session.auraId) return null;

    // Only process closed sessions
    if (session.state && String(session.state).toLowerCase() !== 'closed') return null;

    // Determine work order type from events
    var workOrderType = determineWorkOrderType(events);
    if (!workOrderType) return null;

    // License plate: front/back logic
    var front = session.vehicleFrontPlate || session.vehicleFrontPlate === 0 ? String(session.vehicleFrontPlate) : '';
    var back = session.vehicleBackPlate || session.vehicleBackPlate === 0 ? String(session.vehicleBackPlate) : '';
    var licensePlate = '';
    if (front && back) {
        licensePlate = front + '/' + back;
    } else if (front) {
        licensePlate = front;
    } else {
        licensePlate = back;
    }

    // Extract weighings
    var firstWeighing = extractFirstWeighing(events);
    var secondWeighing = extractSecondWeighing(events);

    // Net quantity = |2nd - 1st|
    var netQuantityKg = null;
    if (firstWeighing.kg !== null && secondWeighing.kg !== null) {
        netQuantityKg = Math.abs(secondWeighing.kg - firstWeighing.kg);
    }

    return {
        sessionAuraId: session.auraId,
        driver: session.driver || null,
        licensePlate: licensePlate || null,
        workOrderType: workOrderType,
        sessionCreationTime: parseDate(session.createdOn),
        sessionClosingTime: parseDate(session.modifiedOn),
        status: session.state || null,
        derivate: extractDerivate(events),
        smsNotificationTime: extractSmsNotificationTime(events),
        firstWeighingTime: firstWeighing.time,
        firstWeighingKg: firstWeighing.kg,
        secondWeighingTime: secondWeighing.time,
        secondWeighingKg: secondWeighing.kg,
        netQuantityKg: netQuantityKg,
        barrierEntranceTime: extractBarrierTime(events, 'Barrier_Entrance'),
        barrierExitTime: extractBarrierTime(events, 'Barrier_Exit'),
    };
}

// ── Private extraction functions ────────────────────────────────────

function determineWorkOrderType(events) {
    for (var i = 0; i < events.length; i++) {
        var src = String(events[i].occurenceSource || '').toLowerCase();
        if (src.includes('unloading')) return 'unload';
    }
    for (var j = 0; j < events.length; j++) {
        var src2 = String(events[j].occurenceSource || '').toLowerCase();
        if (src2.includes('loading')) return 'load';
    }
    return null;
}

function extractDerivate(events) {
    var smsEvents = filterSmsEvents(events);
    if (smsEvents.length === 0) return null;

    var materialSet = {};
    for (var i = 0; i < smsEvents.length; i++) {
        var message = String(smsEvents[i].message || '');
        var idx = message.toLowerCase().indexOf('material: ');
        if (idx >= 0) {
            var text = message.substring(idx + 'material: '.length).trim();
            if (text) materialSet[text] = true;
        }
    }

    var keys = Object.keys(materialSet);
    if (keys.length === 0) return null;

    var cleaned = keys
        .map(function (m) { return m.replace(/\s+\d+$/, '').trim(); })
        .map(function (m) { return m.replace(/KONTROLNO/gi, '').trim(); })
        .filter(function (m) { return m.length > 0; });

    return cleaned.length > 0 ? cleaned.join('; ') : null;
}

function extractSmsNotificationTime(events) {
    var smsEvents = filterSmsEvents(events);
    if (smsEvents.length === 0) return null;

    smsEvents.sort(function (a, b) {
        return new Date(a.dtOccurence) - new Date(b.dtOccurence);
    });

    return parseDate(smsEvents[0].dtOccurence);
}

function extractFirstWeighing(events) {
    var filtered = events.filter(function (e) {
        return String(e.source || '').toUpperCase() === 'LOADING' &&
               String(e.type || '').toLowerCase() === 'weighing' &&
               String(e.topic || '').toLowerCase() === 'measurement';
    });

    if (filtered.length === 0) return { time: null, kg: null };

    filtered.sort(function (a, b) {
        return new Date(a.dtOccurence) - new Date(b.dtOccurence);
    });

    return {
        time: parseDate(filtered[0].dtOccurence),
        kg: parseNumber(filtered[0].value),
    };
}

function extractSecondWeighing(events) {
    var filtered = events.filter(function (e) {
        return String(e.source || '').toUpperCase() === 'PARKING' &&
               String(e.type || '').toLowerCase() === 'weighing' &&
               String(e.topic || '').toLowerCase() === 'measurement';
    });

    if (filtered.length === 0) return { time: null, kg: null };

    filtered.sort(function (a, b) {
        return new Date(b.dtOccurence) - new Date(a.dtOccurence);
    });

    return {
        time: parseDate(filtered[0].dtOccurence),
        kg: parseNumber(filtered[0].value),
    };
}

function extractBarrierTime(events, messageMatch) {
    var matching = events.filter(function (e) {
        return String(e.message || '') === messageMatch;
    });

    if (matching.length === 0) return null;

    matching.sort(function (a, b) {
        return new Date(a.dtOccurence) - new Date(b.dtOccurence);
    });

    return parseDate(matching[0].dtOccurence);
}

function filterSmsEvents(events) {
    return events.filter(function (e) {
        var src = String(e.source || '').toLowerCase();
        var typ = String(e.type || '').toLowerCase();
        var top = String(e.topic || '').toLowerCase();
        var val = String(e.value || '').toLowerCase();
        return src === 'sms service' && typ === 'sms' && top === 'send' && val.includes('new task');
    });
}

// ── Utility ────────────────────────────────────────────────────────

function parseDate(val) {
    if (!val) return null;
    try {
        var d = new Date(val);
        if (isNaN(d.getTime())) return null;
        return d.toISOString();
    } catch (e) {
        return null;
    }
}

function parseNumber(val) {
    if (val === null || val === undefined) return null;
    var str = String(val);
    var match = str.match(/-?\d+[\.,]?\d*/);
    if (!match) return null;
    var num = parseFloat(match[0].replace(',', '.'));
    return isNaN(num) ? null : num;
}

module.exports = { processSession };
