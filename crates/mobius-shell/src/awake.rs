//! Stopping the computer sleeping while the agent works.
use std::sync::mpsc::{Sender, channel};

use mobius_host::awake::Blocker;

/// Holds the system awake from a thread of its own: the setting belongs to the thread that made it, and the thread must
/// stay alive for as long as the hold lasts.
pub struct SystemBlocker {
    hold: Option<Sender<()>>,
}

impl SystemBlocker {
    pub fn new() -> SystemBlocker {
        SystemBlocker { hold: None }
    }
}

impl Blocker for SystemBlocker {
    fn start(&mut self) {
        if self.hold.is_some() {
            return;
        }
        let (tx, rx) = channel::<()>();
        std::thread::spawn(move || {
            #[cfg(windows)]
            {
                use windows::Win32::System::Power::{ES_CONTINUOUS, ES_SYSTEM_REQUIRED, SetThreadExecutionState};
                // SAFETY: a plain call that only sets this thread's power request.
                unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
                let _ = rx.recv();
                // SAFETY: as above; clears the request.
                unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
            }
            #[cfg(not(windows))]
            let _ = rx.recv();
        });
        self.hold = Some(tx);
    }

    fn stop(&mut self) {
        // Dropping the sender ends the thread, which lets go.
        self.hold = None;
    }
}
