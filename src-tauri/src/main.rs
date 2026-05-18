// Prevents additional console window on Windows in release; not relevant on macOS
// but kept for cross-platform hygiene.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    linear_board_lib::run()
}
