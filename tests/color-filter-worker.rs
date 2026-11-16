//! Host harness for the real serialized worker and its fake display backend.
#[path = "../src-tauri/src/color_vision.rs"]
mod color_vision;
#[path = "../src-tauri/src/color_filter.rs"]
mod color_filter;
mod diag { pub fn log(_message: impl AsRef<str>) {} }
