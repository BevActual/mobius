//! The one shortcut that works from anywhere on the computer: it brings Mobius up and starts a message. It is off until a
//! combination is chosen. Another program may already own a combination, which is reported rather than hidden.
use std::sync::Arc;

use mobius_store::keys::to_accelerator;

/// The system's global shortcut registration.
pub trait Registrar: Send {
    /// Takes the combination; false when it could not be taken (another program has it, or it is not allowed).
    fn register(&mut self, accelerator: &str, on_press: Arc<dyn Fn() + Send + Sync>) -> bool;
    fn unregister(&mut self, accelerator: &str);
}

pub struct QuickEntry {
    registrar: Box<dyn Registrar>,
    on_press: Arc<dyn Fn() + Send + Sync>,
    accelerator: Option<String>,
    wanted: String,
}

impl QuickEntry {
    pub fn new(registrar: Box<dyn Registrar>, on_press: Arc<dyn Fn() + Send + Sync>) -> QuickEntry {
        QuickEntry { registrar, on_press, accelerator: None, wanted: String::new() }
    }

    /// Use this combination, or none with an empty one. Returns false when it could not be taken.
    pub fn set(&mut self, binding: &str) -> bool {
        self.release();
        self.wanted = binding.to_owned();
        if binding.is_empty() {
            return true;
        }
        let Some(accelerator) = to_accelerator(binding) else { return false };
        if !self.registrar.register(&accelerator, self.on_press.clone()) {
            return false;
        }
        self.accelerator = Some(accelerator);
        true
    }

    /// Whether the chosen combination is working right now. False when none is chosen.
    pub fn active(&self) -> bool {
        self.accelerator.is_some()
    }

    /// The combination that was asked for, whether or not it could be taken.
    pub fn requested(&self) -> &str {
        &self.wanted
    }

    /// Does what pressing the combination does.
    pub fn press(&self) {
        (self.on_press)();
    }

    fn release(&mut self) {
        if let Some(accelerator) = self.accelerator.take() {
            self.registrar.unregister(&accelerator);
        }
    }
}

impl Drop for QuickEntry {
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct Fake {
        taken: HashSet<String>,
        mine: HashMap<String, Arc<dyn Fn() + Send + Sync>>,
    }
    struct Shared(Arc<Mutex<Fake>>);
    impl Registrar for Shared {
        fn register(&mut self, accelerator: &str, on_press: Arc<dyn Fn() + Send + Sync>) -> bool {
            let mut f = self.0.lock().unwrap();
            if f.taken.contains(accelerator) || f.mine.contains_key(accelerator) {
                return false;
            }
            f.mine.insert(accelerator.to_owned(), on_press);
            true
        }
        fn unregister(&mut self, accelerator: &str) {
            self.0.lock().unwrap().mine.remove(accelerator);
        }
    }

    fn quick() -> (QuickEntry, Arc<Mutex<Fake>>, Arc<AtomicUsize>) {
        let fake = Arc::new(Mutex::new(Fake::default()));
        let pressed = Arc::new(AtomicUsize::new(0));
        let counter = pressed.clone();
        (QuickEntry::new(Box::new(Shared(fake.clone())), Arc::new(move || { counter.fetch_add(1, Ordering::SeqCst); })), fake, pressed)
    }

    #[test]
    fn it_is_off_until_a_combination_is_chosen_and_registers_it_in_the_form_the_system_wants() {
        let (mut q, fake, _) = quick();
        assert!(!q.active());
        assert!(q.set("mod+alt+space"));
        assert!(q.active());
        assert_eq!(fake.lock().unwrap().mine.keys().cloned().collect::<Vec<_>>(), vec!["CommandOrControl+Alt+Space"]);
        assert_eq!(q.requested(), "mod+alt+space");
    }

    #[test]
    fn pressing_the_combination_runs_what_it_was_given() {
        let (mut q, fake, pressed) = quick();
        q.set("mod+alt+space");
        let handler = fake.lock().unwrap().mine["CommandOrControl+Alt+Space"].clone();
        handler();
        q.press();
        assert_eq!(pressed.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn choosing_another_or_none_gives_the_old_combination_back() {
        let (mut q, fake, _) = quick();
        q.set("mod+alt+space");
        q.set("mod+alt+j");
        assert_eq!(fake.lock().unwrap().mine.keys().cloned().collect::<Vec<_>>(), vec!["CommandOrControl+Alt+J"]);
        assert!(q.set(""));
        assert!(fake.lock().unwrap().mine.is_empty() && !q.active());
        assert_eq!(q.requested(), "");
    }

    #[test]
    fn a_combination_another_program_has_is_reported_and_remembered_as_wanted() {
        let (mut q, fake, _) = quick();
        fake.lock().unwrap().taken.insert("CommandOrControl+Alt+J".into());
        assert!(!q.set("mod+alt+j"));
        assert!(!q.active());
        assert_eq!(q.requested(), "mod+alt+j");
        assert!(q.set("mod+alt+k"), "a free one works afterwards");
    }

    #[test]
    fn a_combination_that_may_not_be_global_is_refused_without_asking_the_system() {
        let (mut q, fake, _) = quick();
        for bad in ["k", "mod+c", "nonsense"] {
            assert!(!q.set(bad), "{bad}");
        }
        assert!(fake.lock().unwrap().mine.is_empty());
    }

    #[test]
    fn dropping_it_gives_the_combination_back() {
        let (mut q, fake, _) = quick();
        q.set("mod+alt+space");
        drop(q);
        assert!(fake.lock().unwrap().mine.is_empty());
    }
}
