//! Superseded-request dropping. A caller may tag a render with a lane and a
//! generation: a newer generation on the same lane means the caller will
//! throw away every older result, so a request that is still queued when it
//! gets its turn is dropped instead of being sent to a worker.
//!
//! The lane is chosen by the caller and should be unique per view (the JS
//! side includes a per-page-load token), so a reloaded view starting again
//! at generation 1 is never held back by an old, higher number.

use std::collections::HashMap;
use std::sync::Mutex;

/// Error text for a dropped request. The caller recognises it and ignores it.
pub const RENDER_SUPERSEDED: &str = "render superseded";

/// Lanes kept before the table is reset. Forgetting a lane only means its
/// queued requests run as before; it never drops a current one.
const MAX_LANES: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RenderTicket {
    pub lane: String,
    pub generation: u64,
}

impl RenderTicket {
    pub fn from_request(lane: Option<String>, generation: Option<u64>) -> Option<Self> {
        match (lane, generation) {
            (Some(lane), Some(generation)) if !lane.is_empty() => Some(Self { lane, generation }),
            _ => None,
        }
    }
}

#[derive(Default)]
pub struct SupersedeTable {
    latest: Mutex<HashMap<String, u64>>,
}

impl SupersedeTable {
    /// Record that `ticket`'s generation exists on its lane.
    pub fn note(&self, ticket: &RenderTicket) {
        let Ok(mut latest) = self.latest.lock() else { return };
        if !latest.contains_key(&ticket.lane) && latest.len() >= MAX_LANES {
            latest.clear();
        }
        let entry = latest.entry(ticket.lane.clone()).or_insert(ticket.generation);
        if *entry < ticket.generation { *entry = ticket.generation; }
    }

    /// Has a newer generation been submitted on `ticket`'s lane?
    pub fn superseded(&self, ticket: &RenderTicket) -> bool {
        self.latest.lock().ok()
            .and_then(|latest| latest.get(&ticket.lane).copied())
            .is_some_and(|newest| newest > ticket.generation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket(lane: &str, generation: u64) -> RenderTicket {
        RenderTicket { lane: lane.to_string(), generation }
    }

    #[test]
    fn only_an_older_generation_on_the_same_lane_is_superseded() {
        let table = SupersedeTable::default();
        table.note(&ticket("a", 3));
        assert!(!table.superseded(&ticket("a", 3)));
        table.note(&ticket("a", 4));
        assert!(table.superseded(&ticket("a", 3)));
        assert!(!table.superseded(&ticket("a", 4)));
        assert!(!table.superseded(&ticket("b", 1)));
        // A late older request never lowers the lane's generation.
        table.note(&ticket("a", 2));
        assert!(!table.superseded(&ticket("a", 4)));
    }

    #[test]
    fn a_full_table_forgets_lanes_instead_of_dropping_current_work() {
        let table = SupersedeTable::default();
        table.note(&ticket("old", 1));
        table.note(&ticket("old", 9));
        for lane in 0..MAX_LANES { table.note(&ticket(&lane.to_string(), 1)); }
        assert!(!table.superseded(&ticket("old", 1)));
    }

    #[test]
    fn a_request_needs_both_lane_and_generation() {
        assert_eq!(RenderTicket::from_request(None, Some(1)), None);
        assert_eq!(RenderTicket::from_request(Some(String::new()), Some(1)), None);
        assert_eq!(RenderTicket::from_request(Some("a".into()), None), None);
        assert_eq!(RenderTicket::from_request(Some("a".into()), Some(1)), Some(ticket("a", 1)));
    }
}
