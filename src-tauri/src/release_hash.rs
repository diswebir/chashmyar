//! SHA-256 hashes for the headless release-payload audit.
//! Kept independently testable against the same `sha2` API as the application.

use sha2::{Digest, Sha256};
use std::fmt::Write as _;

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    // sha2 0.11 returns a hybrid-array that does not implement LowerHex.
    // Format each byte explicitly, including a leading zero where necessary.
    let mut hex = String::with_capacity(64);
    for byte in Sha256::digest(bytes).iter() {
        write!(&mut hex, "{byte:02x}").expect("writing to a String cannot fail");
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::sha256_hex;

    #[test]
    fn hashes_empty_ascii_and_binary_input_as_lowercase_padded_hex() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(sha256_hex(&[0, 255, 128]), "f742b965f156c10374bc23aea96e3a8aff8facd6fc079defeaa30219ad86f211");
    }
}
