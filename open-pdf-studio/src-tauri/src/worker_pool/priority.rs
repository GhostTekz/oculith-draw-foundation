//! One exchange per worker, with invalidations ahead of renders and a small
//! foreground burst before a waiting thumbnail gets a turn.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tokio::sync::watch;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Priority {
    Barrier,
    Foreground,
    Background,
}

#[derive(Default)]
struct State {
    active: bool,
    barriers: usize,
    foreground: usize,
    background: usize,
    foreground_burst: usize,
}

pub struct PriorityGate {
    state: Mutex<State>,
    changed: watch::Sender<u64>,
    generation: AtomicU64,
}

impl Default for PriorityGate {
    fn default() -> Self {
        let (changed, _) = watch::channel(0);
        Self { state: Mutex::new(State::default()), changed, generation: AtomicU64::new(0) }
    }
}

impl PriorityGate {
    fn wake_waiters(&self) {
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.changed.send_replace(generation);
    }

    pub async fn acquire(&self, priority: Priority) -> Permit<'_> {
        let mut changed = self.changed.subscribe();
        {
            let mut state = self.state.lock().unwrap();
            match priority {
                Priority::Barrier => state.barriers += 1,
                Priority::Foreground => state.foreground += 1,
                Priority::Background => state.background += 1,
            }
        }
        let mut waiting = Waiting { gate: self, priority, registered: true };
        loop {
            {
                let mut state = self.state.lock().unwrap();
                let can_enter = !state.active && match priority {
                    Priority::Barrier => true,
                    Priority::Foreground => state.barriers == 0
                        && !(state.foreground_burst >= 4 && state.background > 0),
                    Priority::Background => state.barriers == 0
                        && (state.foreground == 0 || state.foreground_burst >= 4),
                };
                if can_enter {
                    state.active = true;
                    waiting.registered = false;
                    match priority {
                        Priority::Barrier => state.barriers -= 1,
                        Priority::Foreground => {
                            state.foreground -= 1;
                            state.foreground_burst = (state.foreground_burst + 1).min(4);
                        }
                        Priority::Background => {
                            state.background -= 1;
                            state.foreground_burst = 0;
                        }
                    }
                    return Permit { gate: self };
                }
            }
            // Watch retains the latest generation if a release raced with
            // this wait, so a wakeup cannot disappear between check and await.
            if changed.changed().await.is_err() { unreachable!("priority gate sender lives with receiver") }
        }
    }
}

struct Waiting<'a> {
    gate: &'a PriorityGate,
    priority: Priority,
    registered: bool,
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        if !self.registered { return; }
        let mut state = self.gate.state.lock().unwrap();
        match self.priority {
            Priority::Barrier => state.barriers -= 1,
            Priority::Foreground => state.foreground -= 1,
            Priority::Background => state.background -= 1,
        }
        drop(state);
        self.gate.wake_waiters();
    }
}

pub struct Permit<'a> { gate: &'a PriorityGate }

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        let mut state = self.gate.state.lock().unwrap();
        state.active = false;
        drop(state);
        self.gate.wake_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    async fn wait_for_waiters(gate: &PriorityGate, priority: Priority, count: usize) {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                let state = gate.state.lock().unwrap();
                let waiting = match priority {
                    Priority::Barrier => state.barriers,
                    Priority::Foreground => state.foreground,
                    Priority::Background => state.background,
                };
                if waiting == count { break; }
                drop(state);
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
    }

    #[tokio::test]
    async fn foreground_runs_before_queued_background() {
        let gate = Arc::new(PriorityGate::default());
        let active = gate.acquire(Priority::Background).await;
        let (tx, mut order) = tokio::sync::mpsc::unbounded_channel();
        let background_gate = gate.clone();
        let background_tx = tx.clone();
        let background = tokio::spawn(async move {
            let _permit = background_gate.acquire(Priority::Background).await;
            background_tx.send(Priority::Background).unwrap();
        });
        wait_for_waiters(&gate, Priority::Background, 1).await;
        let foreground_gate = gate.clone();
        let foreground = tokio::spawn(async move {
            let _permit = foreground_gate.acquire(Priority::Foreground).await;
            tx.send(Priority::Foreground).unwrap();
        });
        wait_for_waiters(&gate, Priority::Foreground, 1).await;
        drop(active);
        assert_eq!(order.recv().await, Some(Priority::Foreground));
        assert_eq!(order.recv().await, Some(Priority::Background));
        foreground.await.unwrap();
        background.await.unwrap();
    }

    #[tokio::test]
    async fn a_waiting_thumbnail_runs_after_four_foreground_exchanges() {
        let gate = Arc::new(PriorityGate::default());
        let active = gate.acquire(Priority::Background).await;
        let (tx, mut order) = tokio::sync::mpsc::unbounded_channel();
        let mut tasks = Vec::new();
        for _ in 0..5 {
            let gate = gate.clone();
            let tx = tx.clone();
            tasks.push(tokio::spawn(async move {
                let _permit = gate.acquire(Priority::Foreground).await;
                tx.send(Priority::Foreground).unwrap();
            }));
        }
        let background_gate = gate.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = background_gate.acquire(Priority::Background).await;
            tx.send(Priority::Background).unwrap();
        }));
        wait_for_waiters(&gate, Priority::Foreground, 5).await;
        wait_for_waiters(&gate, Priority::Background, 1).await;
        drop(active);
        let mut observed = Vec::new();
        for _ in 0..6 {
            observed.push(tokio::time::timeout(std::time::Duration::from_secs(1), order.recv()).await.unwrap().unwrap());
        }
        assert_eq!(observed, [Priority::Foreground, Priority::Foreground,
            Priority::Foreground, Priority::Foreground, Priority::Background, Priority::Foreground]);
        for task in tasks { task.await.unwrap(); }
    }

    #[tokio::test]
    async fn cancelling_a_foreground_waiter_unblocks_background() {
        let gate = Arc::new(PriorityGate::default());
        let active = gate.acquire(Priority::Background).await;
        let foreground_gate = gate.clone();
        let foreground = tokio::spawn(async move {
            let _permit = foreground_gate.acquire(Priority::Foreground).await;
        });
        wait_for_waiters(&gate, Priority::Foreground, 1).await;
        foreground.abort();
        let _ = foreground.await;
        drop(active);
        let _background = tokio::time::timeout(std::time::Duration::from_secs(1),
            gate.acquire(Priority::Background)).await.unwrap();
    }

    #[tokio::test]
    async fn invalidation_barrier_precedes_waiting_renders() {
        let gate = Arc::new(PriorityGate::default());
        let active = gate.acquire(Priority::Foreground).await;
        let (tx, mut order) = tokio::sync::mpsc::unbounded_channel();
        let mut tasks = Vec::new();
        for priority in [Priority::Background, Priority::Foreground, Priority::Barrier] {
            let gate = gate.clone();
            let tx = tx.clone();
            tasks.push(tokio::spawn(async move {
                let _permit = gate.acquire(priority).await;
                tx.send(priority).unwrap();
            }));
        }
        for priority in [Priority::Background, Priority::Foreground, Priority::Barrier] {
            wait_for_waiters(&gate, priority, 1).await;
        }
        drop(active);
        assert_eq!(order.recv().await, Some(Priority::Barrier));
        assert_eq!(order.recv().await, Some(Priority::Foreground));
        assert_eq!(order.recv().await, Some(Priority::Background));
        for task in tasks { task.await.unwrap(); }
    }
}
