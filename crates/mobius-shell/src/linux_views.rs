//! Linux: Tauri packs every child web view into the window's vertical `GtkBox`, one under the other, so views cannot
//! sit on top of each other and the interface ends up a pixel tall under the page view. Here each view is moved into
//! one `GtkFixed` that fills the window, where it is placed and sized like a child view on Windows and macOS. Views
//! added later sit above earlier ones, so pages stay over the interface.
use gtk::prelude::*;
use tauri::{Webview, Wry};

const FIXED: &str = "mobius-views";

fn widget_of(platform: &tauri::webview::PlatformWebview) -> gtk::Widget {
    platform.inner().upcast()
}

/// The shared `GtkFixed`, made the first time and put in the box Tauri uses.
fn fixed_in(vbox: &gtk::Box) -> gtk::Fixed {
    if let Some(found) = vbox.children().into_iter().find(|c| c.widget_name() == FIXED).and_then(|c| c.downcast::<gtk::Fixed>().ok()) {
        return found;
    }
    let fixed = gtk::Fixed::new();
    fixed.set_widget_name(FIXED);
    vbox.pack_start(&fixed, true, true, 0);
    fixed.show();
    fixed
}

/// Put the view at `x, y` with the given size (logical pixels), moving it into the shared container if it is not there yet.
pub fn place(webview: &Webview<Wry>, x: f64, y: f64, width: f64, height: f64) {
    let _ = webview.with_webview(move |platform| {
        let view = widget_of(&platform);
        let (x, y) = (x.round() as i32, y.round() as i32);
        let (w, h) = (width.round().max(1.0) as i32, height.round().max(1.0) as i32);
        let Some(parent) = view.parent() else { return };
        if let Ok(fixed) = parent.clone().downcast::<gtk::Fixed>() {
            fixed.move_(&view, x, y);
        } else if let Ok(vbox) = parent.downcast::<gtk::Box>() {
            let fixed = fixed_in(&vbox);
            vbox.remove(&view);
            fixed.put(&view, x, y);
        } else {
            return;
        }
        view.set_size_request(w, h);
    });
}

