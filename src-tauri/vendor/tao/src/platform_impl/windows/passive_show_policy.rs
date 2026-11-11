// ChashmYar local addition to Tao 0.37.2, Apache-2.0.
// See CHASHMYAR_PATCH.md in the vendored Tao root.
// Kept free of Win32 types so the actual decision can be tested on any host.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShowMode {
  FirstUnfocused,
  WithoutActivation,
  Normal,
}

pub(crate) const fn show_mode(first_unfocused: bool, passive_show: bool, focusable: bool) -> ShowMode {
  if first_unfocused {
    ShowMode::FirstUnfocused
  } else if passive_show || !focusable {
    ShowMode::WithoutActivation
  } else {
    ShowMode::Normal
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn initial_show_keeps_tao_first_show_behavior() {
    for passive in [false, true] {
      for focusable in [false, true] {
        assert_eq!(show_mode(true, passive, focusable), ShowMode::FirstUnfocused);
      }
    }
  }

  #[test]
  fn hidden_unfocused_notifications_stay_focusable_but_show_passively() {
    // The window remains keyboard/mouse focusable: only automatic show is passive.
    assert_eq!(show_mode(false, true, true), ShowMode::WithoutActivation);
    assert_eq!(show_mode(false, true, false), ShowMode::WithoutActivation);
  }

  #[test]
  fn nonfocusable_and_regular_windows_use_correct_modes() {
    assert_eq!(show_mode(false, false, false), ShowMode::WithoutActivation);
    assert_eq!(show_mode(false, false, true), ShowMode::Normal);
  }
}
