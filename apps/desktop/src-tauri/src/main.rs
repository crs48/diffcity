#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(unix)]
    if let Some(argument) = std::env::args().nth(1) {
        if argument.starts_with("chrome-extension://") {
            let result = tokio::runtime::Runtime::new()
                .expect("Native runtime")
                .block_on(diffcity_lib::native_messaging::run(&argument));
            if let Err(error) = result {
                eprintln!("Diff City companion: {error:#}");
                std::process::exit(1);
            }
            return;
        }
        if argument == "--register-browser" {
            match diffcity_lib::native_messaging::install() {
                Ok(paths) => println!("Registered Diff City for Chrome: {}", paths.join(", ")),
                Err(error) => {
                    eprintln!("{error:#}");
                    std::process::exit(1);
                }
            }
            return;
        }
    }
    diffcity_lib::run();
}
