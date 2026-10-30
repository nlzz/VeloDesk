//! Módulo de Injeção de Entradas do Windows
//!
//! Converte comandos recebidos pelo Data Channel em eventos nativos do sistema
//! operacional via Win32 `SendInput`.

pub mod injector;

pub use injector::{DefaultInputInjector, InputInjector};
