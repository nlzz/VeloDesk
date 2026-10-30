//! Ponto de entrada do executável VeloDesk Viewer Desktop.

// Oculta janela de console secundária no subsistema Windows em compilações de release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    velodesk_viewer_lib::run();
}
