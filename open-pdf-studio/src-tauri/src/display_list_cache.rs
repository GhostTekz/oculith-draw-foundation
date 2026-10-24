use std::collections::HashMap;
use std::sync::Arc;

/// The generation protects inserts into the document cache and related page
/// classification and tile-scene caches. Callers hold the outer mutex while
/// checking a generation and touching a related cache.
pub struct GenerationCache<T> {
    generation: u64,
    entries: HashMap<String, Arc<T>>,
}

impl<T> Default for GenerationCache<T> {
    fn default() -> Self {
        Self {
            generation: 0,
            entries: HashMap::new(),
        }
    }
}

impl<T> GenerationCache<T> {
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn with_generation<R>(&self, generation: u64, operation: impl FnOnce() -> R) -> Option<R> {
        (self.generation == generation).then(operation)
    }

    pub fn get_if_generation(&self, generation: u64, path: &str) -> Option<Arc<T>> {
        self.with_generation(generation, || self.entries.get(path).cloned())
            .flatten()
    }

    pub fn insert_if_generation(
        &mut self,
        generation: u64,
        path: String,
        value: Arc<T>,
    ) -> Option<Arc<T>> {
        if self.generation != generation {
            return None;
        }
        Some(self.entries.entry(path).or_insert(value).clone())
    }

    pub fn invalidate_path(
        &mut self,
        path: &str,
        evict_related: impl FnOnce() -> Result<(), String>,
    ) -> Result<Option<Arc<T>>, String> {
        self.generation = self.generation.wrapping_add(1);
        let removed = self.entries.remove(path);
        evict_related()?;
        Ok(removed)
    }

    pub fn clear(
        &mut self,
        evict_related: impl FnOnce() -> Result<(), String>,
    ) -> Result<Vec<Arc<T>>, String> {
        self.generation = self.generation.wrapping_add(1);
        let removed = self.entries.drain().map(|(_, value)| value).collect();
        evict_related()?;
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::GenerationCache;
    use std::collections::HashMap;
    use std::sync::{mpsc, Arc, Mutex};

    #[test]
    fn paused_document_load_cannot_restore_invalidated_handle() {
        let cache = Arc::new(Mutex::new(GenerationCache::<u8>::default()));
        let generation = cache.lock().unwrap().generation();
        let (started_tx, started_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let rendering_cache = Arc::clone(&cache);
        let rendering = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            resume_rx.recv().unwrap();
            rendering_cache.lock().unwrap().insert_if_generation(
                generation,
                "drawing.pdf".into(),
                Arc::new(1),
            )
        });

        started_rx.recv().unwrap();
        cache
            .lock()
            .unwrap()
            .invalidate_path("drawing.pdf", || Ok(()))
            .unwrap();
        resume_tx.send(()).unwrap();
        assert!(rendering.join().unwrap().is_none());
        let mut guard = cache.lock().unwrap();
        assert!(guard
            .get_if_generation(guard.generation(), "drawing.pdf")
            .is_none());
        let fresh = guard.generation();
        assert_eq!(
            **guard
                .insert_if_generation(fresh, "drawing.pdf".into(), Arc::new(2))
                .as_ref()
                .unwrap(),
            2
        );
    }

    #[test]
    fn paused_page_and_scene_results_cannot_restore_after_invalidation() {
        let cache = Arc::new(Mutex::new(GenerationCache::<u8>::default()));
        let pages = Arc::new(Mutex::new(HashMap::<(String, u32), String>::new()));
        let scenes = Arc::new(Mutex::new(HashMap::<String, String>::new()));
        let path = "drawing.pdf";
        let generation = cache.lock().unwrap().generation();
        pages.lock().unwrap().insert((path.into(), 0), "old".into());
        scenes
            .lock()
            .unwrap()
            .insert(format!("{path}|same-mtime|same-length|p0"), "old".into());

        let (started_tx, started_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let render_cache = Arc::clone(&cache);
        let render_pages = Arc::clone(&pages);
        let render_scenes = Arc::clone(&scenes);
        let rendering = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            resume_rx.recv().unwrap();
            let guard = render_cache.lock().unwrap();
            guard.with_generation(generation, || {
                render_pages
                    .lock()
                    .unwrap()
                    .insert((path.into(), 0), "stale".into());
                render_scenes
                    .lock()
                    .unwrap()
                    .insert(format!("{path}|same-mtime|same-length|p0"), "stale".into());
            })
        });

        started_rx.recv().unwrap();
        cache
            .lock()
            .unwrap()
            .invalidate_path(path, || {
                pages.lock().unwrap().retain(|(p, _), _| p != path);
                scenes
                    .lock()
                    .unwrap()
                    .retain(|key, _| !key.starts_with(&format!("{path}|")));
                Ok(())
            })
            .unwrap();
        resume_tx.send(()).unwrap();
        assert!(rendering.join().unwrap().is_none());
        assert!(pages.lock().unwrap().is_empty());
        assert!(scenes.lock().unwrap().is_empty());
    }

    #[test]
    fn full_clear_rejects_all_prior_generations_and_clears_related_caches() {
        let mut cache = GenerationCache::<u8>::default();
        let pages = Mutex::new(HashMap::<(String, u32), String>::new());
        let scenes = Mutex::new(HashMap::<String, String>::new());
        let before = cache.generation();
        cache.insert_if_generation(before, "first.pdf".into(), Arc::new(1));
        cache.insert_if_generation(before, "second.pdf".into(), Arc::new(2));
        pages
            .lock()
            .unwrap()
            .insert(("first.pdf".into(), 0), "vector".into());
        scenes
            .lock()
            .unwrap()
            .insert("second.pdf|p0".into(), "scene".into());

        assert_eq!(
            cache
                .clear(|| {
                    pages.lock().unwrap().clear();
                    scenes.lock().unwrap().clear();
                    Ok(())
                })
                .unwrap()
                .len(),
            2
        );
        assert!(cache
            .insert_if_generation(before, "first.pdf".into(), Arc::new(3))
            .is_none());
        assert!(pages.lock().unwrap().is_empty());
        assert!(scenes.lock().unwrap().is_empty());
    }
}
