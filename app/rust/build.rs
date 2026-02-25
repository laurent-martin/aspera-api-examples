use std::env;

/// compilation of the proto file
fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Get the proto file path from the environment variable
    let proto_path = env::var("SDK_FILE_PROTO").expect("SDK_FILE_PROTO environment variable must be set");

    // Compile the proto file
    tonic_build::compile_protos(&proto_path)?;
    Ok(())
}
