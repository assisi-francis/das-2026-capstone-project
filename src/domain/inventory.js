// Build 1: the domain core, running entirely in memory.
// No server, no database. Just objects, Maps and rules.
// The API (Build 4) uses src/services/ and src/repositories/ instead. This file
// stays for `npm run demo` and shares its input rules via validation.js.

import { newId, newReference } from './ids.js';
import { Queue } from './waitlistQueue.js';
import { DomainError } from './errors.js';
import { summarizeEvent } from './eventSearch.js';
import {
  MAX_TICKETS_PER_BOOKING,
  assertSeatsAvailable,
  requireDate,
  requireQuantity,
  requireText,
  requireWholeNumber,
  seatsLeft,
} from './validation.js';

export { MAX_TICKETS_PER_BOOKING, seatsLeft };

// Bookings in these states are holding seats. A cancelled one is not.
const HOLDS_SEATS = new Set(['pending', 'paid']);

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('VALIDATION', `${label} must be an object`);
  }
  return value;
}

function requireStore(store) {
  requireObject(store, 'store');
  for (const key of ['events', 'tiers', 'bookings', 'bookingsByReference', 'waitlists']) {
    if (!(store[key] instanceof Map)) {
      throw new DomainError('VALIDATION', `store.${key} must be a Map`);
    }
  }
  return store;
}

export function createStore() {
  return {
    events: new Map(), // eventId -> event
    tiers: new Map(), // tierId -> tier
    bookings: new Map(), // bookingId -> booking
    bookingsByReference: new Map(), // reference -> booking  (hash map = O(1) lookup)
    waitlists: new Map(), // tierId -> Queue
  };
}

function getTier(store, tierId) {
  const tier = store.tiers.get(tierId);
  if (!tier) throw new DomainError('NOT_FOUND', 'Ticket tier not found');
  return tier;
}

function getEvent(store, eventId) {
  const event = store.events.get(eventId);
  if (!event) throw new DomainError('NOT_FOUND', 'Event not found');
  return event;
}

export function createEvent(store, input) {
  requireStore(store);
  const { title, city, venue = '', startsAt, organizerId } = requireObject(input, 'event');
  if (venue !== undefined && typeof venue !== 'string') {
    throw new DomainError('VALIDATION', 'Venue must be text');
  }
  const validatedOrganizerId = organizerId === undefined ? undefined : requireText(organizerId, 'Organizer');

  const event = {
    id: newId(),
    organizerId: validatedOrganizerId,
    title: requireText(title, 'Title'),
    city: requireText(city, 'City'),
    venue: venue.trim(),
    startsAt: requireDate(startsAt, 'startsAt'),
    status: 'draft',
    tierIds: [],
  };
  store.events.set(event.id, event);
  return event;
}

export function addTier(store, eventId, input) {
  requireStore(store);
  requireText(eventId, 'eventId');
  const { name, priceCents, capacity } = requireObject(input, 'tier');
  const event = getEvent(store, eventId);

  const validatedPrice = requireWholeNumber(priceCents, 'priceCents', 0);
  if (validatedPrice > Math.floor(Number.MAX_SAFE_INTEGER / MAX_TICKETS_PER_BOOKING)) {
    throw new DomainError('VALIDATION', 'priceCents is too large to calculate a booking total safely');
  }
  const tier = {
    id: newId(),
    eventId,
    name: requireText(name, 'Tier name'),
    // Money is ALWAYS whole cents. 0.1 + 0.2 !== 0.3 in floating point.
    priceCents: validatedPrice,
    capacity: requireWholeNumber(capacity, 'capacity', 1),
    sold: 0,
  };
  store.tiers.set(tier.id, tier);
  store.waitlists.set(tier.id, new Queue());
  event.tierIds.push(tier.id);
  return tier;
}

export function publishEvent(store, eventId) {
  requireStore(store);
  requireText(eventId, 'eventId');
  const event = getEvent(store, eventId);
  if (event.tierIds.length === 0) {
    throw new DomainError('INVALID_STATE', 'Add at least one ticket tier before publishing');
  }
  event.status = 'published';
  return event;
}

// What the public event list is built from. Drafts are hidden unless asked for.
export function listEventSummaries(store, options = {}) {
  requireStore(store);
  const { publishedOnly = true } = requireObject(options, 'options');
  if (typeof publishedOnly !== 'boolean') {
    throw new DomainError('VALIDATION', 'publishedOnly must be a boolean');
  }
  return [...store.events.values()]
    .filter((event) => !publishedOnly || event.status === 'published')
    .map((event) => summarizeEvent(event, event.tierIds.map((id) => store.tiers.get(id))));
}

export function bookTickets(store, tierId, userId, quantity) {
  requireStore(store);
  requireText(tierId, 'tierId');
  const validatedUserId = requireText(userId, 'userId');
  const tier = getTier(store, tierId);
  requireQuantity(quantity);
  assertSeatsAvailable(tier, quantity);

  let reference;
  do {
    reference = newReference();
  } while (store.bookingsByReference.has(reference));

  const booking = {
    id: newId(),
    reference,
    userId: validatedUserId,
    tierId,
    quantity,
    amountCents: tier.priceCents * quantity,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  tier.sold += quantity;
  store.bookings.set(booking.id, booking);
  store.bookingsByReference.set(reference, booking);
  return booking;
}

export function findBookingByReference(store, reference) {
  requireStore(store);
  return store.bookingsByReference.get(requireText(reference, 'reference'));
}

export function cancelBooking(store, reference) {
  requireStore(store);
  requireText(reference, 'reference');
  const booking = findBookingByReference(store, reference);
  if (!booking) throw new DomainError('NOT_FOUND', 'Booking not found');
  if (!HOLDS_SEATS.has(booking.status)) {
    throw new DomainError('INVALID_STATE', `A ${booking.status} booking cannot be cancelled`);
  }
  getTier(store, booking.tierId).sold -= booking.quantity;
  booking.status = 'cancelled';
  return booking;
}

export function joinWaitlist(store, tierId, userId, quantity) {
  requireStore(store);
  requireText(tierId, 'tierId');
  const validatedUserId = requireText(userId, 'userId');
  const tier = getTier(store, tierId);
  requireQuantity(quantity);
  if (seatsLeft(tier) >= quantity) {
    throw new DomainError('NOT_SOLD_OUT', 'Seats are available, so book them instead');
  }
  const queue = store.waitlists.get(tierId);
  queue.enqueue({ userId: validatedUserId, quantity });
  return { position: queue.size };
}

// Strict first-in-first-out: only the person at the head of the line is considered.
// Discussion question for class: what happens if the head wants 4 seats and only 1 is free?
export function offerNextOnWaitlist(store, tierId) {
  requireStore(store);
  requireText(tierId, 'tierId');
  const tier = getTier(store, tierId);
  const queue = store.waitlists.get(tierId);
  const head = queue.peek();
  if (!head || seatsLeft(tier) < head.quantity) return undefined;
  return queue.dequeue();
}
