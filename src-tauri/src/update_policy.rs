//! Pure validation for the fixed GitHub Release endpoint and Windows payloads.
const REPOSITORY: &str = "https://github.com/diswebir/chashmyar/releases/download";

pub fn stable_version(version: &str) -> bool {
    let components: Vec<_> = version.split('.').collect();
    components.len() == 3 && components.iter().all(|s| {
        !s.is_empty() && s.len() <= 5 && (s.len() == 1 || !s.starts_with('0'))
            && s.bytes().all(|b| b.is_ascii_digit())
            && s.parse::<u32>().map(|v| v <= 65535).unwrap_or(false)
    })
}

pub fn expected_download_url(version: &str, portable: bool) -> Option<String> {
    if !stable_version(version) { return None; }
    let name = if portable {
        format!("ChashmYar-{version}-portable.exe")
    } else {
        format!("ChashmYar_{version}_x64-setup.exe")
    };
    Some(format!("{REPOSITORY}/v{version}/{name}"))
}

pub fn valid_windows_payload(bytes: &[u8], portable: bool) -> bool {
    if bytes.len() < 0x40 || &bytes[..2] != b"MZ" { return false; }
    let offset = u32::from_le_bytes([bytes[0x3c], bytes[0x3d], bytes[0x3e], bytes[0x3f]]) as usize;
    let Some(end) = offset.checked_add(6) else { return false; };
    if end > bytes.len() || &bytes[offset..offset + 4] != b"PE\0\0" { return false; }
    let machine = u16::from_le_bytes([bytes[offset + 4], bytes[offset + 5]]);
    machine == 0x8664 || (!portable && machine == 0x14c)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pe(machine: u16) -> Vec<u8> {
        let mut bytes = vec![0u8; 128];
        bytes[..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&64u32.to_le_bytes());
        bytes[64..68].copy_from_slice(b"PE\0\0");
        bytes[68..70].copy_from_slice(&machine.to_le_bytes());
        bytes
    }
    #[test]
    fn accepts_only_stable_bounded_versions() {
        for good in ["0.0.0", "2.4.7", "65535.65535.65535"] { assert!(stable_version(good)); }
        for bad in ["v2.4.7", "2.04.7", "2.4", "2.4.7-beta", "65536.1.1", "../2.4", "1.2.3/evil", "1.2.3\n"] {
            assert!(!stable_version(bad), "accepted {bad:?}");
        }
    }
    #[test]
    fn download_url_is_exact_and_flavour_specific() {
        assert_eq!(expected_download_url("2.4.7", false).unwrap(), "https://github.com/diswebir/chashmyar/releases/download/v2.4.7/ChashmYar_2.4.7_x64-setup.exe");
        assert_eq!(expected_download_url("2.4.7", true).unwrap(), "https://github.com/diswebir/chashmyar/releases/download/v2.4.7/ChashmYar-2.4.7-portable.exe");
        assert!(expected_download_url("1.2.3/evil", true).is_none());
    }
    #[test]
    fn rejects_wrong_or_malformed_pe() {
        assert!(valid_windows_payload(&pe(0x8664), true));
        assert!(!valid_windows_payload(&pe(0x14c), true));
        assert!(valid_windows_payload(&pe(0x14c), false));
        assert!(!valid_windows_payload(&pe(0xaa64), false));
        assert!(!valid_windows_payload(b"MZ", true));
        let mut bad = pe(0x8664); bad[0x3c..0x40].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(!valid_windows_payload(&bad, true));
    }
}
