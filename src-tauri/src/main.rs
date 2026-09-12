// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ak820_pro_macos_lib::run()
}
