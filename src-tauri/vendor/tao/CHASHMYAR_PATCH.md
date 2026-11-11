# Local changes to Tao 0.37.2

This directory is a local, modified copy of the `tao` 0.37.2 crate (upstream
revision `2d9b2ba15247879787878ae565e350bcc1b9f622`) from
<https://github.com/tauri-apps/tao>. Tao remains under **Apache-2.0**; its
original `LICENSE`, `LICENSE.spdx`, copyright headers and source are included.
ChashmYar's MIT license does not relicense Tao. `Cargo.toml` uses a local
`[patch.crates-io]` so locked CI builds cannot silently bypass this fix.

## Modified and added files

- `src/platform_impl/windows/window.rs` marks windows constructed both hidden
  and unfocused as preferring passive subsequent show operations.
- `src/platform_impl/windows/window_state.rs` uses the new policy and the
  Win32 `SW_SHOWNA` command for those windows and for non-focusable windows.
- `src/platform_impl/windows/passive_show_policy.rs` is ChashmYar's small,
  host-testable policy implementation and its truth-table tests.

In locked Tao 0.37.2 the initial unfocused marker is cleared after creation;
subsequent `.show()` uses `SW_SHOW`, which may activate a window even with
`WS_EX_NOACTIVATE`. See <https://github.com/tauri-apps/tao/pull/1358> and
<https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow>.
The local extension also keeps initially hidden and unfocused **but focusable**
notification windows passive when shown. They can still be deliberately clicked
or focused; the break lock explicitly calls `set_focus()` and remains focusable.
The original first-show behavior is retained, and `SW_SHOWNA` does not restore
minimized or maximized windows. No native-only visibility state is maintained
outside Tao, so its show/hide bookkeeping remains synchronized.

Do not remove the patch until a replacement offers equivalent semantics for
focusable notifications, the overlay, and the explicit strict-lock focus. Run
`npm run test:logic`, `npm run licenses:check`, and the native Windows focus,
notification-button, lock and multi-monitor checklist before updating Tao.
