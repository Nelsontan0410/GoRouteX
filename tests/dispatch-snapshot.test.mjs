import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotRouteStops } from '../driver/route-model.js';
import { startExecution } from '../driver/execution.js';

test('driver execution follows finalized optimized order and keeps finalized ETAs', () => {
  const route = {
    id: 'owner_plan_1', assignedDriverUid: 'driver-uid',
    plannedRoutes: [{
      id: 1,
      originalWaypoints: ['a', 'b'],
      optimizedStops: ['depot', 'b', 'a'],
      customerStops: [
        { id: 'a', stopName: 'A', deliveryAddress: 'A Street' },
        { id: 'b', stopName: 'B', deliveryAddress: 'B Street' }
      ],
      detailedStopTimes: [
        { stopId: 'b', arrivalTimeStr: '09:25 AM' },
        { stopId: 'a', arrivalTimeStr: '10:05 AM' }
      ]
    }]
  };
  const stops = snapshotRouteStops(route);
  assert.deepEqual(stops.map(stop => stop.stopName), ['B', 'A']);
  assert.deepEqual(stops.map(stop => stop.plannedEta), ['09:25 AM', '10:05 AM']);
  const execution = startExecution(route, 'driver-uid');
  route.plannedRoutes[0].customerStops[1].deliveryAddress = 'Changed later';
  assert.equal(execution.stops[0].deliveryAddress, 'B Street');
});
